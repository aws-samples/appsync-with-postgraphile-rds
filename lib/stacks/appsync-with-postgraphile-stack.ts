import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import {Vpc, SecurityGroup, SubnetType } from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import { Role, ServicePrincipal, ManagedPolicy, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { 
  NodejsFunction,
} from 'aws-cdk-lib/aws-lambda-nodejs';
import { 
  Architecture,
  Code,
  LayerVersion,
  Runtime,
} from 'aws-cdk-lib/aws-lambda';
import { AwsCustomResource, AwsCustomResourcePolicy } from 'aws-cdk-lib/custom-resources';
import * as path from 'path';

export interface AppSyncWithPostgraphileProps extends cdk.StackProps {
  vpc?: Vpc;
  vpcId?: string;
  port: number;
  securityGroupIds: string[];
  rdsProxy: (string|rds.DatabaseProxy);
  dbName: string;
  dbSchemas: string[];
  dbUsername: string;
}


export class AppSyncWithPostgraphileStack extends cdk.Stack {

  private readonly basicExecutionPolicy = ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole');
  private readonly vpcAccessExecutionPolicy = ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole');

  private readonly PG_LAMBDA_RESOLVER_ID = 'PG_CONNECTOR';
  private readonly PG_LAMBDA_RESOLVER_FN = 'PG_CONNECTOR_FN';

  constructor(scope: Construct, id: string, props: AppSyncWithPostgraphileProps) {
    super(scope, id, props)

    const {
      vpc,
      vpcId,
      securityGroupIds,
      dbName,
      dbSchemas,
      dbUsername,
      port
    } = props;

    // Validate that either vpc or vpcId is provided, but not both
    if (!vpc && !vpcId) {
      throw new Error('Either vpc or vpcId must be provided');
    }
    if (vpc && vpcId) {
      throw new Error('Cannot provide both vpc and vpcId. Choose one.');
    }

    // Load VPC - either from provided vpc object or lookup by vpcId
    const resolvedVpc = vpc || Vpc.fromLookup(this, 'Vpc', { vpcId: vpcId! });

    // Load security groups
    const securityGroups = securityGroupIds.map((sgId) => SecurityGroup.fromSecurityGroupId(this, 
      `sg-${sgId}`, sgId, { mutable: false }));

    let rdsProxy: rds.IDatabaseProxy;
    if(typeof props.rdsProxy === 'string') {
      const proxyInfo = new AwsCustomResource(this, 'DescribeDBProxy', {
      onCreate: {
        service: '@aws-sdk/client-rds',
        action: 'DescribeDBProxiesCommand',
        parameters: {
          DBProxyName: props.rdsProxy,
        },
      },
      policy: AwsCustomResourcePolicy.fromSdkCalls({ resources: AwsCustomResourcePolicy.ANY_RESOURCE }),
    });
    //Token.asString
      rdsProxy = rds.DatabaseProxy.fromDatabaseProxyAttributes(this, 'ImportDBProxy', {
        dbProxyName: proxyInfo.getResponseField('DBProxies.0.DBProxyName'),
        dbProxyArn: proxyInfo.getResponseField('DBProxies.0.DBProxyArn'),
        endpoint: proxyInfo.getResponseField('DBProxies.0.endpoint'),
        securityGroups: []
      });
    } else {
      rdsProxy = props.rdsProxy;
    }
    
    // layer with all the libraries required to use postgraphile
    const pgLayer = new LayerVersion(this, 'pgLayer', {
      compatibleRuntimes: [Runtime.NODEJS_20_X, Runtime.NODEJS_22_X, Runtime.NODEJS_LATEST],
      code: Code.fromAsset(path.join(__dirname, '../layers/pg-as-datasource-layer')),
      description: `appsync-with-postgraphile libraries and utilities`,
    });

    // lambda env variables
    const defaultLambdaEnv = {
      RDS_PROXY_URL: rdsProxy.endpoint,
      PORT: port.toString(),
      USERNAME: dbUsername,
      DATABASE: dbName,
      PG_SCHEMAS: dbSchemas.join(','),
      POSTGRAPHILE_PREPARED_STATEMENT_CACHE_SIZE: '0', //dont cache since we are using rds proxy's pool
      // DEBUG: 'postgraphile:postgres,graphile-build-pg,graphile-build-pg:*',
    }


    // Dependencies included in layer.
    // Exclude from function bundle to reduce size
    // aws-sdk not included by default: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda_nodejs.BundlingOptions.html
    const externalModules = [
      'pg',
      'postgraphile',
      'graphql',
      'graphile-build',
      'graphile-utils',
      '@graphile-contrib/pg-simplify-inflector',
      'adm-zip',
    ]

    const resolverFnRole = new Role(this, 'resolver-lambda-role', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [this.basicExecutionPolicy, this.vpcAccessExecutionPolicy]
    });

    // resolver function
    const resolver = new NodejsFunction(this, 'resolver', {
      entry: path.join(__dirname, '..', 'functions', 'query-resolver', 'resolver.ts'),
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(29),
      role: resolverFnRole,
      vpc: resolvedVpc,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: securityGroups,
      layers: [pgLayer],
      bundling: { externalModules },
      environment: defaultLambdaEnv,
    });

    rdsProxy.grantConnect(resolver, dbUsername);

    // api start
    const graphqlApi = new appsync.GraphqlApi(this, 'api', {
      name: 'api-with-postgraphile',
      definition: appsync.Definition.fromFile(
        path.join(__dirname, '..', 'graphql','schema','schema.graphql'),
      ),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.API_KEY,
        },
      },
    });


    // Datasource used for Subscription resolver
    const noneDS = new appsync.NoneDataSource(this, 'NONE', {
      api: graphqlApi,
      name: 'NONE',
    });

    const lambdaDs = new appsync.LambdaDataSource(this, 'pg-lambda-resolver', 
      {
        api: graphqlApi,
        name: this.PG_LAMBDA_RESOLVER_ID,
        lambdaFunction: resolver,
        description: `Lambda Data Source for ${resolver.functionName}`,
      }
    );

    const lambdaFnResolver = new appsync.AppsyncFunction(this, 'pg-lambda-resolver-fn', {
      dataSource: lambdaDs,
      name: this.PG_LAMBDA_RESOLVER_FN,
      api: graphqlApi,
      code: appsync.Code.fromAsset(path.join(__dirname, '..', 'graphql', 'resolvers', 'baseLambdaResolver.js')),
      runtime: appsync.FunctionRuntime.JS_1_0_0
    });

    const providerFnRole = new Role(this, 'provider-lambda-role', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [this.basicExecutionPolicy, this.vpcAccessExecutionPolicy]
    });

    // this provider will save the schema info to Lambda Layer so that we can then create the cache
    const provider = new NodejsFunction(this, 'providerFn', {
      entry: path.join(__dirname, '..', 'functions', 'schema-provider', 'provider.ts'),
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(300),
      role: providerFnRole,
      vpc: resolvedVpc,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: securityGroups,
      layers: [pgLayer],
      bundling: { externalModules },
      environment: {
        APPSYNC_API_ID: graphqlApi.apiId,
        PG_LAMBDA_RESOLVER_FN_ID: lambdaFnResolver.functionId,
        RESOLVER_LAMBDA_FN: resolver.functionName,
        CACHE_LAYER_NAME: `cacheLayer-${id}`,
        ...defaultLambdaEnv
      }
    });

    rdsProxy.grantConnect(provider, dbUsername);

    provider.addToRolePolicy(
      new PolicyStatement({
        sid: 'AllowUpdateFunctionLayerVersion',
        actions: [
          'lambda:GetFunctionConfiguration',
          'lambda:updateFunctionConfiguration'
        ],
        resources: [resolver.functionArn],
      })
    );

    provider.addToRolePolicy(
      new PolicyStatement({
        sid: 'AllowPublishLayerVersions',
        actions: [
          'lambda:GetLayerVersion',
          'lambda:PublishLayerVersion',
          'lambda:AddLayerVersionPermission',
          'lambda:ListLayerVersions',
          'lambda:DeleteLayerVersion',
          'lambda:GetLayerVersionPolicy',
          'lambda:UpdateLayerVersionPermission',
        ],
        resources: [
          this.formatArn({
            arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
            service: 'lambda',
            resource: 'layer',
            resourceName: `cacheLayer-${id}`,
          }),
          this.formatArn({
            arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
            service: 'lambda',
            resource: 'layer',
            resourceName: `cacheLayer-${id}:*`,
          }),
        ],
      })
    );

    provider.addToRolePolicy(
      new PolicyStatement({
        actions: ['lambda:GetLayerVersion', 'lambda:GetLayerVersionPolicy'],
        resources: [pgLayer.layerVersionArn],
      })
    );

    provider.addToRolePolicy(
      new PolicyStatement({
        actions: ['appsync:*'],
        resources: [graphqlApi.arn, `${graphqlApi.arn}/*`]
      })
    );

    const url = `https://${cdk.Aws.REGION}.console.aws.amazon.com/appsync/home?region=${cdk.Aws.REGION}#/${graphqlApi.apiId}/v1/queries`

    new cdk.CfnOutput(this, 'QueryEditorURL', { value: url })
    new cdk.CfnOutput(this, 'resolverName', { value: resolver.functionName })
    new cdk.CfnOutput(this, 'providerName', { value: provider.functionName })
    new cdk.CfnOutput(this, 'appsyncApiID', { value: graphqlApi.apiId })
  }
}
