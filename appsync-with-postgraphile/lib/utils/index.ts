import { MutationPayloadQueryPlugin, NodePlugin, SchemaBuilder } from 'graphile-build'
import { makeWrapResolversPlugin } from 'graphile-utils'
import simplifyInflectorPlugin from '@graphile-contrib/pg-simplify-inflector'
import { GraphQLInputFieldConfigMap, GraphQLSchema, printSchema } from 'graphql'
import { GraphQLNonNull, isObjectType } from 'graphql/type/definition'
import { createPostGraphileSchema, makePluginHook } from 'postgraphile'
import { Pool } from 'pg'

/**
 * Postgraphile plugin which forces `NOT NULL` column to be generated
 * as Nullable field in graphql schema. Required for Primary Keys that
 * use auto-generated default values from sequences.
 */
const forceNullablePlugin = (builder: SchemaBuilder) => {
  const forceNullable = (fields: GraphQLInputFieldConfigMap, name: string): void => {
    if (fields[name]) {
      const field = fields[name]
      if (field.type instanceof GraphQLNonNull) {
        fields[name].type = field.type.ofType
      }
    }
  }
  builder.hook('GraphQLInputObjectType:fields', (fields) => {
    // Call for each NotNullable field that should be forced as Nullable
    forceNullable(fields, 'id')
    return fields
  })
}

/**
 * make sure we remove nested query from Query type
 * @param  {SchemaBuilder} builder
 */
const removeNestedQueryFieldPlugin = (builder: SchemaBuilder) => {
  builder.hook('GraphQLObjectType:fields', (fields) => {
    if (fields['query']) {
      delete fields['query']
    }
    if (fields['clientMutationId']) {
      delete fields['clientMutationId']
    }
    const names = Object.keys(fields)
    for (const name of names) {
      if (name.match(/deleted\w+NodeId/)) {
        delete fields[name]
      }
    }
    return fields
  })
  builder.hook('GraphQLInputObjectType:fields', (fields) => {
    if (fields['clientMutationId']) {
      delete fields['clientMutationId']
    }
    return fields
  })
}
/**
 * Simple Plugin to turn a date into a valid AWSAppSyncDate format
 */
const makeIso8601CompliantDatePlugin = makeWrapResolversPlugin(
  (context) => {
    const name = context.scope.fieldName
    if (name === 'createdAt' || name === 'updatedAt') {
      return { scope: context.scope }
    }
    return null
  },
  ({ scope }) =>
    async (resolver, source, args, context, info) => {
      // console.log(`Handling '${scope.fieldName}' starting with arguments:`, args)
      const result = await resolver(source, args, context, info)
      // console.log(`Result '${scope.fieldName}' result:`, result)
      return new Date(result).toISOString()
    }
)
export async function loadGraphqlSchema(pgConfig: Pool, schemas: string[], settings?: any) {
  return await createPostGraphileSchema(pgConfig, schemas, {
    appendPlugins: [
      simplifyInflectorPlugin,
      forceNullablePlugin,
      removeNestedQueryFieldPlugin,
      makeIso8601CompliantDatePlugin,
    ],
    skipPlugins: [NodePlugin, MutationPayloadQueryPlugin],
    graphileBuildOptions: {
      pgShortPk: true,
      pgSimplifyAllRows: true,
      pgOmitListSuffix: true,
    },
    legacyRelations: 'omit',
    ignoreRBAC: false,
    simpleCollections: 'only',
    ...settings,
  })
}
/**
 * From a Graphile provided schema, identifies Payload Objects and determines which types they are wrapping
 * @param  {GraphQLSchema} schema
 */
export function getWrappers(schema: GraphQLSchema) {
  const types = schema.getTypeMap()
  const names = Object.keys(types)
  const wrappers: { [key: string]: any } = {}
  for (const typeName of names) {
    if (typeName.match(/\w+Payload/)) {
      const type = types[typeName]
      if (isObjectType(type)) {
        console.log('found:', typeName)
        for (const [fieldName, field] of Object.entries(type.getFields())) {
          console.log('fieldname:', fieldName)
          const reg = new RegExp(`\\w+${fieldName}Payload`, 'i')
          if (typeName.match(reg)) {
            wrappers[typeName] = {
              fieldName,
              fieldType: field.type.toString(),
            }
          }
        }
      }
    }
  }
  return wrappers
}
/**
 * Transforms a schema into a AppSync compliant schema string
 * @param  {GraphQLSchema} schema
 */
export function toAppSyncSchema(schema: GraphQLSchema) {
  const str = printSchema(schema)
  const printed = str
    .replace(/(\s|\[)BigInt/g, '$1Int')
    .replace(/(\s|\[)BigFloat/g, '$1Float')
    .replace(/(\s|\[)Cursor/g, '$1String')
    .replace(/(\s|\[)Time/g, '$1String')
    .replace(/(\s|\[)Datetime/g, '$1AWSDateTime')
    .replace(/(\s|\[)UUID/g, '$1ID')
    .replace(/scalar .*\n/g, '')
    .replace(/ *#.*\n/g, '')
    .replace(/\n *\n/g, '\n')

  return convertComments(printed)
}
/**
 * Takes in a schema string and transofrms multi-line comments into single line comments
 * @param  {string} schema a GraphQL schema SDL
 */
const convertComments = (schema: string) => {
  const reg = /^(\s*)"""\s*([^"]+)\s*"""\s*$/gm

  const replacer = (match: string, p1: string, ...rest: any[]) => {
    // console.log('>>>')
    // console.log(`p1: [${p1}]`)
    // console.log(match)
    const replacement = match
      .replace(/^\s*"""\s*/, '')
      .replace(/\s*"""\s*$/, '')
      .split('\n')
      .map((s) => p1.replace(/./g, ' ') + '# ' + s.trim())
      .join('\n')
    // console.log(`out: [${replacement}]`)
    // console.log('<<<')
    // console.log()
    return replacement
  }

  const ns = schema.replace(reg, replacer)
  return ns
}

interface Config {
  database: string
  user: string
  password: string
  host: string
  port: number
}
/**
 * Creates a database connection given the configuration
 * @param  {Config} config
 */
export function createDatabaseConnection(config: Config): Pool {
  console.log('Creating new DB connection')
  return new Pool({
    min: 0,
    max: 1,
    idleTimeoutMillis: 0.001,
    ssl: true,
    // settings
    ...config,
  })
}
/**
 * Takes an object and returns a flattend version of the object
 * @param  {{[key:string]:any}|null|undefined} from
 * @param  {{[key:string]:string}} to
 * @param  {string} prefix?
 */
export function toFlatMap(
  from: { [key: string]: any } | null | undefined,
  to: { [key: string]: string },
  prefix?: string
) {
  if (!from) {
    return to
  }

  Object.entries(from).forEach(([key, value]) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'object') {
      toFlatMap(value, to, nextPrefix)
    } else {
      to[nextPrefix] = value
    }
  })
  return to
}
