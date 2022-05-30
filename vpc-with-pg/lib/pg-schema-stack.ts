import {
    Duration,
    Stack,
    StackProps,
    CfnOutput,
} from 'aws-cdk-lib'
import { Construct } from 'constructs'
import { NodejsFunction, NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as rds from 'aws-cdk-lib/aws-rds'
import * as Path from 'path'
import { Architecture, Code, LayerVersion, Runtime } from 'aws-cdk-lib/aws-lambda'


export interface SchemaProps extends StackProps {
    vpc: ec2.Vpc
    port: number
    stage: string
    rdsProxy: rds.DatabaseProxy
    sg: ec2.ISecurityGroup
    userName: string
    database: string
}

export class PgSchemaStack extends Stack {
    constructor(scope: Construct, id: string, props: SchemaProps) {
        super(scope, id, props)

        const stack = Stack.of(this)
        const region = stack.region


        const PG_LAMBDA_RESOLVER_ID = 'PG_CONNECTOR'
        const PG_LAMBDA_RESOLVER_FN = 'PG_CONNECTOR_FN'

        // layer with all the libraries required to use postgraphile
        const layer = new LayerVersion(this, 'pglayer', {
            compatibleRuntimes: [Runtime.NODEJS_14_X],
            code: Code.fromAsset(Path.join(__dirname, 'layers/pg-dbschema-layer')),
            description: 'pg-dbschema sql',
        })

        // lambda env variables
        const environment = {
            REGION: region,
            RDS_PROXY_URL: props.rdsProxy.endpoint,
            USERNAME: props.userName,
            PORT: props.port,
            DATABASE: props.database,
            POSTGRAPHILE_PREPARED_STATEMENT_CACHE_SIZE: '0', //dont cache since we are using rds proxy's pool
        }
        const externalModules = [
            'aws-sdk',
            'pg',
        ]
        const lambdaConfig: NodejsFunctionProps = {
            vpc: props.vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_NAT },
            // memorySize: 1024,
            securityGroups: props.sg,
            timeout: Duration.seconds(300),
            environment,
            layers: [layer],
            architecture: Architecture.ARM_64,
            bundling: { externalModules },
        }


        // db schema function
        const dbSchemaHandler = new NodejsFunction(this, 'dbSchemaHandler', {
            entry: Path.join(__dirname, 'functions', 'dbschema.ts'),
            ...lambdaConfig,
            timeout: Duration.seconds(60),
        })
        props.rdsProxy.grantConnect(dbSchemaHandler, props.userName)


        new CfnOutput(this, 'dbSchemaHandlerName', { value: dbSchemaHandler.functionName })

    }
}
