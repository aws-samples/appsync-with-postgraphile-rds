import * as AWS from 'aws-sdk'
import { Pool } from 'pg'
import { GraphQLSchema, graphql, isObjectType } from 'graphql'
import { withPostGraphileContext } from 'postgraphile'
import { AppSyncResolverEvent } from 'aws-lambda'
import { createDatabaseConnection, loadGraphqlSchema, toFlatMap } from '../utils'

const PORT = parseInt(process.env.PORT!)
const PG_SCHEMAS = (process.env.PG_SCHEMAS || 'postgres').split(',')
const signer = new AWS.RDS.Signer({
  region: process.env.REGION,
  port: PORT,
  username: process.env.USERNAME,
  hostname: process.env.RDS_PROXY_URL,
})

let pgPool: Pool
let schema: GraphQLSchema
const fieldToArgsMap: { [k: string]: { [k in 'op' | 'vars']: string } } = {}

function getAuthToken(signer: AWS.RDS.Signer) {
  return new Promise<string>((resolve, reject) => {
    signer.getAuthToken({}, (err, token) => {
      if (err) {
        reject(err)
      }
      resolve(token)
    })
  })
}

let startAt: Date
function reset() {
  startAt = new Date()
}
function expired() {
  return startAt ? new Date().getTime() - startAt.getTime() > 14 * 60 * 1_000 : false
}

/**
 * Wrap the mutation operations
 */
function createGraphqlSource(event: AppSyncResolverEvent<any, any>): string {
  const fieldName = event.info.fieldName
  const typeName = event.info.parentTypeName
  let selectionSet = event.info.selectionSetGraphQL
  if (typeName === 'Mutation' && event.stash.wrapper) {
    selectionSet = `{${event.stash.wrapper} ${selectionSet}}`
  }

  const args = fieldToArgsMap[typeName + '.' + fieldName]
  if (args) {
    return `${typeName.toLowerCase()}(${args.op}) {\n ${fieldName}(${args.vars}) ${selectionSet}\n}`
  }
  return `${typeName.toLowerCase()} {\n ${fieldName} ${selectionSet}\n}`
}

/**
 * Inits pgPool on first run or if token has expired
 */
async function init() {
  if (!pgPool || expired()) {
    console.log('setting up db connection')
    reset()
    const config = {
      database: process.env.DATABASE!,
      user: process.env.USERNAME!,
      password: await getAuthToken(signer),
      host: process.env.RDS_PROXY_URL!,
      port: PORT,
    }
    pgPool = await createDatabaseConnection(config)
  }
  if (!schema) {
    console.log('start - first schema load')
    schema = await loadGraphqlSchema(pgPool, PG_SCHEMAS, { readCache: `/opt/lib/schema.json` })
    console.log('end - first schema load')

    const myTypes = ['Query', 'Mutation']
    for (const typeName of myTypes) {
      const type = schema.getType(typeName)
      if (type && isObjectType(type)) {
        for (const [fieldName, field] of Object.entries(type.getFields())) {
          if (field.args.length > 0) {
            fieldToArgsMap[type + '.' + fieldName] = {
              op: field.args.map((f) => `$${f.name}: ${f.type.toString()}`).join(', '),
              vars: field.args.map((f) => `${f.name}: $${f.name}`).join(', '),
            }
          }
        }
      }
    }
    console.log(fieldToArgsMap)
  }
}

export const handler = async (event: AppSyncResolverEvent<any, any>): Promise<any> => {
  console.log('appsync request:', JSON.stringify(event, null, 2))

  await init()

  const source = createGraphqlSource(event)
  console.log('SOURCE:', source)

  const inSettings = {
    identity: event.identity,
    ...(event.stash?.pgSettings || {}),
  }
  const pgSettings = toFlatMap(inSettings, 'appsync', '.')

  console.log('pgSettings', pgSettings)

  const pgCallback = (ctx: any) => graphql(schema, source, event.info.parentTypeName, { ...ctx }, event.arguments)
  const result = await withPostGraphileContext({ pgPool, pgSettings }, pgCallback)
  if (result.errors) {
    console.error('ERROR:', result.errors)
    const error = new Error(result.errors[0].message)
    error.name = 'ExecutionError'
    throw error
  }
  console.debug('RESULT:', JSON.stringify(result, null, 2))
  let data = result.data ? result.data[event.info.fieldName] : null
  // unwrap this if necessary
  if (event.info.parentTypeName === 'Mutation' && event.stash.wrapper) {
    data = data[event.stash.wrapper]
  }
  return data
}
