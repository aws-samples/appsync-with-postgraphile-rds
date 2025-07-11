import { Signer } from '@aws-sdk/rds-signer';
import { 
  LambdaClient,
  PublishLayerVersionCommand,
  GetFunctionConfigurationCommand,
  UpdateFunctionConfigurationCommand,
  DeleteLayerVersionCommand
} from '@aws-sdk/client-lambda';
import {
  AppSyncClient,
  StartSchemaCreationCommand,
  GetSchemaCreationStatusCommand,
  GetResolverCommand,
  UpdateResolverCommand,
  CreateResolverCommand,
} from '@aws-sdk/client-appsync';
import { Pool } from 'pg'
import { GraphQLObjectType, GraphQLSchema, isObjectType } from 'graphql'
import { loadGraphqlSchema, createDatabaseConnection, toAppSyncSchema, getWrappers } from '../../utils'
import * as fs from 'fs'
import AdmZip from 'adm-zip';

const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION })
const appsyncClient = new AppSyncClient({ region: process.env.AWS_REGION })

const PORT = parseInt(process.env.PORT!)
const PG_SCHEMAS = (process.env.PG_SCHEMAS || 'postgres').split(',')
const signer = new Signer({
  region: process.env.AWS_REGION,
  port: PORT,
  username: process.env.USERNAME || 'postgres',
  hostname: process.env.RDS_PROXY_URL || '',
})

let pgPool: Pool

export const handler = async (event: any): Promise<any> => {
  console.log('start update process')

  try {
    const config = {
      database: process.env.DATABASE!,
      user: process.env.USERNAME || 'postgres',
      password: await signer.getAuthToken(),
      host: process.env.RDS_PROXY_URL || '',
      port: PORT,
    }

    const dir = '/tmp/cache/lib'
    const file = `${dir}/schema.json`
    fs.mkdirSync(dir, { recursive: true })

    pgPool = pgPool || (await createDatabaseConnection(config))
    const schema = await loadGraphqlSchema(pgPool, PG_SCHEMAS, { writeCache: file })

    await Promise.all([updateLayer(file), updateAppSyncAPI(schema)])
  } catch (error) {
    console.log('oops errors', error)
    if (error instanceof Error) {
      throw new Error(`Failed: ${error.message}`)
    }
  }
}

const updateLayer = async (file: string) => {
  try {
    var zip = new AdmZip()
    zip.addLocalFile(file, './lib')

    const LayerName = process.env.CACHE_LAYER_NAME!
    const FunctionName = process.env.RESOLVER_LAMBDA_FN!

    const result = await lambdaClient.send(new PublishLayerVersionCommand(
      { LayerName, 
        Content: { 
          ZipFile: zip.toBuffer()
        }
      }
    ));

    console.log('PublishLayerVersion: ', result)

    const getConfigResult = await lambdaClient.send(new GetFunctionConfigurationCommand({ FunctionName }))

    let configedLayers = getConfigResult.Layers || []
    console.log('Configured Layers: ', configedLayers)

    const ind = configedLayers.findIndex((layer) => {
      const parts = layer.Arn!.split(':').reverse()
      return parts[1] === LayerName
    });

    const removedLayer = ind > -1 ? configedLayers[ind] : null
    if (ind > -1) {
      console.log('Existing configured layers', removedLayer)
      configedLayers.splice(ind, 1)
    }

    const Layers = configedLayers.map((l) => l.Arn!)
    Layers.push(result.LayerVersionArn!)
    const updateLambdaResult = await lambdaClient.send(new UpdateFunctionConfigurationCommand({ FunctionName, Layers }))

    console.log('updateFunctionConfiguration: ', updateLambdaResult)

    if (removedLayer) {
      const [version, LayerName] = removedLayer.Arn!.split(':').reverse()
      const VersionNumber = parseInt(version)
      const deleteLayerResult = await lambdaClient.send(new DeleteLayerVersionCommand({ LayerName, VersionNumber }))
      console.log('deleteLayerVersion: ', deleteLayerResult)
    }
  } catch (error) {
    console.log('Update Resolver Lambda function error')
  }
}

const updateAppSyncAPI = async (schema: GraphQLSchema) => {
  console.log('load schema')

  const apiId: string = process.env.APPSYNC_API_ID!
  const appsyncFnId: string = process.env.PG_LAMBDA_RESOLVER_FN_ID!

  const typeNames = ['Query', 'Mutation']

  try {
    console.log(`update schema`)

    const wrappers = getWrappers(schema)

    // create subscription for each mutation
    let subscriptions = ''
    const mutationType = schema.getType('Mutation')!
    const subFields: string[] = []
    if (mutationType && isObjectType(mutationType)) {
      subscriptions = `\n\ntype Subscription {\n`
      const fields = mutationType.getFields()
      for (const fieldName in fields) {
        const op = `on${fieldName[0].toUpperCase()}${fieldName.substring(1)}`
        subFields.push(op)
        const field = fields[fieldName]
        const type = field.type.toString()
        subscriptions += ` ${op}(filter: String): ${type} @aws_subscribe(mutations: ['${fieldName}'])\n`
      }
      subscriptions += `}`
      console.log(subscriptions)
    }

    // unwrap mutations. move payload to the type
    let definition = toAppSyncSchema(schema) + subscriptions
    for (const wrapper of Object.keys(wrappers)) {
      definition = definition.replace(new RegExp(`(:\\s+)${wrapper}`, 'g'), `$1${wrappers[wrapper].fieldType}`)
    }

    // remove unused payloads
    definition = definition.replace(/(^\s*#.*$)+\s*type\s+\w+Payload\s*{([^}]*)}/gm, '')

    // start schema creation
    await appsyncClient.send(new StartSchemaCreationCommand({ apiId, definition: new TextEncoder().encode(definition) }))
    let response = await appsyncClient.send(new GetSchemaCreationStatusCommand({ apiId }))
    let status = response.status
    while (status !== 'SUCCESS') {
      console.log(`creattion status: ${status}...`)
      if (status === 'FAILED') {
        console.error('>> Schema creation failed! <<', response)
        throw new Error(response.details)
      }
      await new Promise((r) => setTimeout(r, 250))
      status = (await appsyncClient.send(new GetSchemaCreationStatusCommand({ apiId }))).status
    }

    console.log('completed schema update. continue api update')

    // create a pipeline resolver for Queries and Mutations
    for (const typeName of typeNames) {
      const type = schema.getType(typeName)! as GraphQLObjectType
      for (const fieldName in type.getFields()) {
        const mFieldType = type.getFields()[fieldName].type.toString()
        await createOrUpdatePipelineResolver(apiId, typeName, fieldName, appsyncFnId, wrappers[mFieldType])
      }
    }

    // Create basic subscrption with Enhanced filtering
    for (const fieldName of subFields) {
      await createOrUpdateSubscriptionResolver(apiId, fieldName)
    }
    console.log('api update done')
  } catch (error) {
    console.log('errors during schema creation:', error)
  }
}

const createOrUpdatePipelineResolver = async (
  apiId: string,
  typeName: string,
  fieldName: string,
  fnId: string,
  wrapper: { [key: string]: any }
) => {
  const config = {
    apiId,
    typeName,
    fieldName,
    kind: 'PIPELINE' as const,
    requestMappingTemplate: wrapper
      ? [`$util.qr($ctx.stash.put('wrapper', '${wrapper.fieldName}'))`, '{}'].join('\n')
      : '{}',
    responseMappingTemplate: '$util.toJson($ctx.result)',
    pipelineConfig: { functions: [fnId] },
  }
  try {
    // console.log('start for', typeName, fieldName)
    const result = await appsyncClient.send(new GetResolverCommand({ apiId, typeName, fieldName }))
    console.log(
      `Skipping existing resolver ${typeName}.${fieldName} with functions ${result.resolver?.pipelineConfig?.functions?.join(
        ','
      )}`
    )
    await appsyncClient.send(new UpdateResolverCommand(config))
  } catch (error) {
    const e = error as Error & { code: string }
    if (e.name === 'NotFoundException') {
      console.log(`Create resolver ${typeName}.${fieldName}`)
      await appsyncClient.send(new CreateResolverCommand(config))
    } else {
      console.log('unknown error not handled')
      console.log(error)
    }
  }
}

const createOrUpdateSubscriptionResolver = async (apiId: string, fieldName: string) => {
  const typeName = 'Subscription'
  const config = {
    apiId,
    typeName,
    fieldName,
    dataSourceName: 'NONE',
    requestMappingTemplate: "{ 'version': '2017-02-28', 'payload': {} }",
    responseMappingTemplate: [
      '#if (!$util.isNullOrEmpty($ctx.args.filter))',
      '$extensions.setSubscriptionFilter($util.transform.toSubscriptionFilter($util.parseJson($ctx.args.filter)))',
      '#end',
      '$util.toJson(null)',
    ].join('\n'),
  }
  try {
    const result = await appsyncClient.send(new GetResolverCommand({ apiId, typeName, fieldName }))
    console.log(`Skipping existing resolver ${typeName}.${fieldName}`)
    await appsyncClient.send(new UpdateResolverCommand(config))
  } catch (error) {
    const e = error as Error & { code: string }
    if (e.name === 'NotFoundException') {
      console.log(`Create resolver ${typeName}.${fieldName}`)
      await appsyncClient.send(new CreateResolverCommand(config))
    } else {
      console.log('unknown error not handled')
      console.log(error)
    }
  }
}
