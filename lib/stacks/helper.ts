import Ajv from 'ajv';


export interface Config {
    region?: string;
    rds_proxy_name?: string;
    db_name?: string;
    db_schemas?: string[];
    db_username?: string;
    vpc_id?: string;
    sg_ids?: string[];
    load_sample_data?: boolean;
    deploy_sample_resources?: boolean;
  }

const sample_config_schema = {
  type: 'object',
  required: ['deploy_sample_resources', 'load_sample_data'],
  additionalProperties: false,
  properties: {
    load_sample_data: {
      type: 'boolean',
    },
    deploy_sample_resources: {
      type: 'boolean',
    },
    db_name: {
        type: 'string'
    },
    db_schemas: {
        type: 'array',
        uniqueItems: true,
        items: {
            type: 'string',
            minLength: 1
        }
    },
    db_username: {
        type: 'string'
    }
  },
    if: {properties: {load_sample_data: {const: false}}},
    then: {required: ['deploy_sample_resources', 'load_sample_data', 'db_name', 'db_username']}
};

const existing_config_schema = {
    type: 'object',
    properties: {
        rds_proxy_name: {
            type: 'string'
        },
        db_name: {
            type: 'string'
        },
        db_schemas: {
            type: 'array',
            uniqueItems: true,
            items: {
                type: 'string',
                minLength: 1
            }
        },
        db_username: {
            type: 'string'
        },
        vpc_id: {
            $ref: '#/definitions/VpcId',
        },
        sg_ids: {
            type: 'array',
            uniqueItems: true,
            items: {
                $ref: '#/definitions/SecurityGroupId'
            },
            minItems: 1
        }
    },
    required: ['rds_proxy_name', 'db_name', 'db_username', 'vpc_id', 'sg_ids'],
    additionalProperties: false,
    definitions: {
        RdsProxyArn: {
            type: 'string',
            pattern: 'arn:aws(-[\\w]+)*:rds:.+:[0-9]{12}:db-proxy:prx\-[a-zA-Z0-9\-]+'
        },
        VpcId: {
            type: 'string',
            pattern: 'vpc-\\w{8}(\\w{9})?'
        },
        SubnetId: {
            type: 'string',
            pattern: 'subnet-\\w{8}(\\w{9})?'
        },
        SecurityGroupId: {
            type: 'string',
            pattern: 'sg-\\w{8}(\\w{9})?'
        }
    }
};


//     definitions: {
//         RdsProxyArn: {
//             type: 'string',
//             pattern: 'arn:aws(-[\\w]+)*:rds:.+:[0-9]{12}:db-proxy:prx\-[a-zA-Z0-9\-]+'
//             //'arn:aws:rds:us-east-1:180810609695:db-proxy:prx-0049428012bb6d0b9'
//             // arn:${Partition}:rds:${Region}:${Account}:db-proxy:${DbProxyId}
//         },
//         VpcId: {
//             type: 'string',
//             pattern: 'vpc-\\w{8}(\\w{9})?'
//         },
//         SubnetId: {
//             type: 'string',
//             pattern: 'subnet-\\w{8}(\\w{9})?'
//         },
//         SecurityGroupId: {
//             type: 'string',
//             pattern: 'sg-\\w{8}(\\w{9})?'
//         }
//     }
// };

const ajv = new Ajv();
const validateSampleResourceConfig = ajv.compile(sample_config_schema);
const validateExistingResourceConfig = ajv.compile(existing_config_schema);


export function validateConfig(config: Config): { status: boolean; deployment: string; } {
let validate;
let type;

    if ( 'deploy_sample_resources' in config && config.deploy_sample_resources ) {
        console.log('checking sample_resources config')
        validate= validateSampleResourceConfig;
        type = 'DEPLOY_SAMPLE_VPC_RDS_RESOURCES';
    } else {
        validate = validateExistingResourceConfig;
        type = 'USE_EXISTING_VPC_RDS_RESOURCES';
    }
    let isValid = validate(config)
  if (!isValid) {
    console.error(validate.errors);
  }
  return {status: isValid, deployment: type}
}