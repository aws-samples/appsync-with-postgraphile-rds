import { Duration, Stack, StackProps, CfnOutput, Aws } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import  { Vpc, SecurityGroup, SubnetType } from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as Path from 'path';
import { Architecture, Code, LayerVersion, Runtime } from 'aws-cdk-lib/aws-lambda';
import { Role, ServicePrincipal, ManagedPolicy } from 'aws-cdk-lib/aws-iam';

import { Secret } from 'aws-cdk-lib/aws-secretsmanager'

export interface SchemaProps extends StackProps {
  vpc: Vpc
  port: number
  stage: string
  rdsProxy: rds.DatabaseProxy
  securityGroup: SecurityGroup
  dbName: string
  lambdaRunnerSecret: Secret
}

export class PgSchemaStack extends Stack {

  private readonly basicExecutionPolicy = ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole');
  private readonly vpcAccessExecutionPolicy = ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole');
  constructor(scope: Construct, id: string, props: SchemaProps) {
    super(scope, id, props)


    // layer with all the libraries required to use postgraphile
    const pglayer = new LayerVersion(this, 'pglayer', {
      compatibleRuntimes: [Runtime.NODEJS_LATEST, Runtime.NODEJS_20_X, Runtime.NODEJS_22_X],
      code: Code.fromAsset(Path.join(__dirname, '..','layers','pg-dbschema-layer')),
      description: `pg-dbschema sql ${Date.now().toString()}`,
    });

    // lambda env variables
    const defaultLambdaEnv = {
      RDS_PROXY_URL: props.rdsProxy.endpoint,
      USERNAME: 'postgres', // data loading needs DB admin user
      PORT: props.port.toString(),
      DATABASE: props.dbName,
      SECRET_ARN: props.lambdaRunnerSecret.secretArn,
      POSTGRAPHILE_PREPARED_STATEMENT_CACHE_SIZE: '0', //dont cache since we are using rds proxy's pool
    };


    // Dependencies included in layer.
    // Exclude from function bundle to reduce size
    // aws-sdk not included by default: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda_nodejs.BundlingOptions.html
    const externalModules = [ 'pg' ];


    const dbSchemaHandlerFnRole = new Role(this, 'db-schema-handler-lambda-role', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [this.basicExecutionPolicy, this.vpcAccessExecutionPolicy]
    });

    const dbSchemaHandler = new NodejsFunction(this, 'dbSchemaHandler', {
      entry: Path.join(__dirname, '..', 'functions', 'sample-db-setup', 'dbschema.ts'),
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: 512,
      timeout: Duration.seconds(300),
      role: dbSchemaHandlerFnRole,
      vpc: props.vpc,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [props.securityGroup],
      layers: [pglayer],
      bundling: { externalModules },
      environment: defaultLambdaEnv,
    });

    props.rdsProxy.grantConnect(dbSchemaHandler, 'postgres'); // data loading needs DB admin user
    props.lambdaRunnerSecret.grantRead(dbSchemaHandler);

    new CfnOutput(this, 'dbSchemaHandlerName', { value: dbSchemaHandler.functionName });
    new CfnOutput(this, 'Region', { value: Aws.REGION });
  }
}
