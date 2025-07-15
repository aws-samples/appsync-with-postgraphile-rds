#!/usr/bin/env node

import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import * as path from 'path';
import { readFileSync, existsSync } from 'fs';
import { PgVpcStack } from '../lib/stacks/pg-vpc-stack';
import { PgRdsStack } from '../lib/stacks/pg-rds-stack';
import { PgSchemaStack } from '../lib/stacks/pg-schema-stack';
import { AppSyncWithPostgraphileStack } from '../lib/stacks/appsync-with-postgraphile-stack';
import { Config, validateConfig } from '../lib/stacks/helper';



// Load and validate configuration
const configPath = path.join(__dirname,'..', 'config', 'config.json');

if (!existsSync(configPath)) {
  throw new Error(`Configuration file not found at ${configPath}`);
}

const config: Config = JSON.parse(readFileSync(configPath).toString());

const config_validation = validateConfig(config)
if (!config_validation.status) {
  console.error(
    'Invalid configuration. Please ensure your config.json contains the proper values.'
  );
  process.exit(1);
}

console.log(
  `Configuration validated successfully. Deployment type: ${config_validation.deployment}`
);

const tagProps = {
  tags: {
    app: 'appsync-rds-pg-as-a-datasource',
  },
};

const stage = 'dev';
const PG_PORT = 5432;

const envConfig = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const app = new cdk.App();

// Deploy based on validation type
if (config_validation.deployment === 'DEPLOY_SAMPLE_VPC_RDS_RESOURCES_SAMPLE_DATA' 
  || config_validation.deployment === 'DEPLOY_SAMPLE_VPC_RDS_RESOURCES_NO_DATA') {

  /**
   * DEPLOYING SAMPLE RESOURCES
   */

  const sample_db_name = 'forum_demo_with_appsync';
  const sample_db_user = 'lambda_runner';
  const sample_db_schemas = ['forum_example', 'forum_example_private'];
  
  if (config.load_sample_data) {
    config.db_name = sample_db_name
    config.db_username = sample_db_user
    config.db_schemas = sample_db_schemas
  }

  if (!('db_schemas' in config) || config.db_schemas!.length < 1) {
    config.db_schemas = ['public']
  }
  // Deploy all stacks for sample resources
  console.log('Deploying with sample VPC and RDS configuration...');

  const vpcStack = new PgVpcStack(app, `PgVpcStack${stage}`, {
    env: envConfig,
    cidr: '10.0.0.0/16',
    ...tagProps,
  });

  const rdsStack = new PgRdsStack(app, `PgRdsStack${stage}`, {
    env: envConfig,
    vpc: vpcStack.vpc,
    port: PG_PORT,
    stage: stage,
    dbUsername: config.db_username!,
    ...tagProps,
  });

  if (config.load_sample_data) {
    // DEPLOYING SAMPLE DATABASE
    new PgSchemaStack(app, `PgSchemaStack${stage}`, {
      env: envConfig,
      vpc: vpcStack.vpc,
      stage: stage,
      port: PG_PORT,
      dbName: config.db_name!,
      rdsProxy: rdsStack.rdsProxy,
      securityGroup: rdsStack.lambdaSecurityGroup,
      lambdaRunnerSecret: rdsStack.lambdaRunnerSecret,
      ...tagProps,
    });

    //TODO: add aws-cdk-lib.triggers.Trigger to invoke data loader function after deployment
  }


  // Deploy AppSync stack with dependencies from created infrastructure
  new AppSyncWithPostgraphileStack(app, `AppSyncWithPostgraphileStack${stage}`, {
    env: envConfig,
    vpc: vpcStack.vpc,
    securityGroupIds: [rdsStack.lambdaSecurityGroup.securityGroupId],
    rdsProxy: rdsStack.rdsProxy.dbProxyArn,
    port: PG_PORT,
    dbName: config.db_name!, // You may need to adjust this based on your RDS setup
    dbSchemas: config.db_schemas!, // Default schemas for sample data
    dbUsername: 'postgres', // Default username for sample setup
    ...tagProps,
  });
  
} else {
  /**
   * ONLY DEPLOYING APPSYNC AND RELATED LAMBDA FUNCTIONS
   */
  console.log('Deploying with existing VPC configuration...');


  // Deploy only AppSync stack using existing infrastructure
  new AppSyncWithPostgraphileStack(app, `AppSyncWithPostgraphileStack${stage}`, {
    env: envConfig,
    vpcId: config.vpc_id!,
    securityGroupIds: config.sg_ids!,
    rdsProxy: config.rds_proxy_name!,
    port: PG_PORT,
    dbName: config.db_name!,
    dbSchemas: config.db_schemas!,
    dbUsername: config.db_username!,
    ...tagProps,
  });
}