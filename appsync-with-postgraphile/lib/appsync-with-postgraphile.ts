import {
  CfnParameter,
  Duration,
  Stack,
  StackProps,
  CfnOutput,
  CfnDeletionPolicy,
  CfnResource,
  ArnFormat,
} from 'aws-cdk-lib'
import { Construct } from 'constructs'
import { NodejsFunction, NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as rds from 'aws-cdk-lib/aws-rds'
import * as Path from 'path'
import { Architecture, Code, LayerVersion, Runtime } from 'aws-cdk-lib/aws-lambda'
import * as AppSync from '@aws-cdk/aws-appsync-alpha'
import { PolicyStatement } from 'aws-cdk-lib/aws-iam'

export class AppSyncWithPostgraphile extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props)

    const stack = Stack.of(this)
    const region = stack.region

    // context
    const vpcId: string = this.node.tryGetContext('vpcId')

    // parameters section
    // security groups for lambda function
    const sgId = new CfnParameter(this, 'sgId', { type: 'CommaDelimitedList' }).valueAsList

    // rds proxy info
    const dbProxyArn = new CfnParameter(this, 'dbProxyArn').valueAsString
    const dbProxyName = new CfnParameter(this, 'dbProxyName').valueAsString
    const endpoint = new CfnParameter(this, 'dbProxyEndpoint').valueAsString

    // required to set up lambda and to connect to database
    const userName = new CfnParameter(this, 'userName', { description: '' }).valueAsString
    const database = new CfnParameter(this, 'database', { description: '' }).valueAsString
    const schemas = new CfnParameter(this, 'schemas', { description: '' }).valueAsString

    // default pg port
    const port = '5432'

    //load vpc and rds proxy info
    const vpc = ec2.Vpc.fromLookup(this, 'Vpc', { vpcId })
    const sgs = sgId.map((s) => ec2.SecurityGroup.fromSecurityGroupId(this, `sg-${s}`, s, { mutable: false }))
    const proxy = rds.DatabaseProxy.fromDatabaseProxyAttributes(this, 'proxy', {
      dbProxyArn,
      dbProxyName,
      endpoint,
      securityGroups: [],
    })

    const PG_LAMBDA_RESOLVER_ID = 'PG_CONNECTOR'
    const PG_LAMBDA_RESOLVER_FN = 'PG_CONNECTOR_FN'

    // layer with all the libraries required to use postgraphile
    const layer = new LayerVersion(this, 'pglayer', {
      compatibleRuntimes: [Runtime.NODEJS_20_X],
      code: Code.fromAsset(Path.join(__dirname, 'layers/pg-as-datasource-layer')),
      description: 'appsync-with-postgraphile libraries and utilities ' + Date.now().toString(),
    })

    // lambda env variables
    const environment = {
      REGION: region,
      RDS_PROXY_URL: endpoint,
      USERNAME: userName,
      PORT: port,
      DATABASE: database,
      PG_SCHEMAS: schemas,
      POSTGRAPHILE_PREPARED_STATEMENT_CACHE_SIZE: '0', //dont cache since we are using rds proxy's pool
      // DEBUG: 'postgraphile:postgres,graphile-build-pg,graphile-build-pg:*',
    }
    const externalModules = [
      'aws-sdk',
      'pg',
      'postgraphile',
      'graphql',
      'graphile-build',
      'graphile-utils',
      '@graphile-contrib/pg-simplify-inflector',
      'adm-zip',
    ]
    const lambdaConfig: NodejsFunctionProps = {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_NAT },
      // memorySize: 1024,
      securityGroups: sgs,
      timeout: Duration.seconds(300),
      environment,
      layers: [layer],
      architecture: Architecture.ARM_64,
      bundling: { externalModules },
    }

    // api start
    const api = new AppSync.GraphqlApi(this, 'api', {
      name: 'api-with-postgraphile',
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: AppSync.AuthorizationType.API_KEY,
        },
      },
    })
    api.addToSchema('# update your schema: `npm run update`\ntype Query { temp: String }')
    // api end

    // resolver function
    const resolver = new NodejsFunction(this, 'resolver', {
      entry: Path.join(__dirname, 'functions', 'resolver.ts'),
      runtime: Runtime.NODEJS_20_X,
      description: Date.now().toString(),
      ...lambdaConfig,
      timeout: Duration.seconds(29),
    })
    proxy.grantConnect(resolver, userName)

    const noneDS = api.addNoneDataSource('NONE')
    let r = noneDS.node.defaultChild as CfnResource
    r.cfnOptions.deletionPolicy = CfnDeletionPolicy.RETAIN
    const ds = api.addLambdaDataSource(PG_LAMBDA_RESOLVER_ID, resolver)
    r = ds.node.defaultChild as CfnResource
    r.cfnOptions.deletionPolicy = CfnDeletionPolicy.RETAIN
    const fn = ds.createFunction({ name: PG_LAMBDA_RESOLVER_FN })
    r = fn.node.defaultChild as CfnResource
    r.cfnOptions.deletionPolicy = CfnDeletionPolicy.RETAIN

    // this provider will save the schema info to s3 so that we can then create the cache layer
    // note: schema is too large to return via attribute
    lambdaConfig.environment!.APPSYNC_API_ID = api.apiId
    lambdaConfig.environment!.PG_LAMBDA_RESOLVER_FN_ID = fn.functionId
    lambdaConfig.environment!.RESOLVER_LAMBDA_FN = resolver.functionName
    lambdaConfig.environment!.CACHE_LAYER_NAME = `cacheLayer-${id}`
    lambdaConfig.environment!.USERNAME = `postgres`
    const provider = new NodejsFunction(this, 'providerFn', {
      entry: Path.join(__dirname, 'functions', 'provider.ts'),
      runtime: Runtime.NODEJS_20_X,
      description: Date.now().toString(),
      ...lambdaConfig,
    })
    proxy.grantConnect(provider, lambdaConfig.environment!.USERNAME)
    provider.addToRolePolicy(
      new PolicyStatement({
        actions: ['lambda:*'],
        resources: [resolver.functionArn],
      })
    )
    provider.addToRolePolicy(
      new PolicyStatement({
        actions: ['lambda:*'],
        resources: [
          stack.formatArn({
            arnFormat: ArnFormat.COLON_RESOURCE_NAME,
            service: 'lambda',
            resource: 'layer',
            resourceName: `cacheLayer-${id}`,
          }),
          stack.formatArn({
            arnFormat: ArnFormat.COLON_RESOURCE_NAME,
            service: 'lambda',
            resource: 'layer',
            resourceName: `cacheLayer-${id}:*`,
          }),
        ],
      })
    )
    provider.addToRolePolicy(
      new PolicyStatement({
        actions: ['lambda:Get*'],
        resources: [layer.layerVersionArn],
      })
    )
    provider.addToRolePolicy(
      new PolicyStatement({
        actions: ['appsync:*'],
        resources: [stack.formatArn({ service: 'appsync', resource: `*/${api.apiId}` })],
      })
    )
    provider.addToRolePolicy(
      new PolicyStatement({
        actions: ['appsync:*'],
        resources: [stack.formatArn({ service: 'appsync', resource: `*/${api.apiId}/*` })],
      })
    )

    const url = `https://${region}.console.aws.amazon.com/appsync/home?region=${region}#/${api.apiId}/v1/queries`

    new CfnOutput(this, 'QueryEditorURL', { value: url })
    new CfnOutput(this, 'resolverName', { value: resolver.functionName })
    new CfnOutput(this, 'providerName', { value: provider.functionName })
    new CfnOutput(this, 'appsyncApiID', { value: api.apiId })
    new CfnOutput(this, 'region', { value: region })
  }
}
