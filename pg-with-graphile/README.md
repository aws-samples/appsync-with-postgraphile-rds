# AppSync - RDS-as-a-Datasource with postgraphile

You must use RDS Proxy with IAM authorization.
https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-proxy.html
## deploy

```sh
# Context
# VPC_ID -> ID of VPC where your PG database is deployed, and Lambda functions will be deployed
# SUBNET_ID -> Private subnet with NAT in which to deploy ENI for Lambda functions 

# Parameters
# SG_ID:-> Security group used by your RDS Proxy. Will be assigned to your Lambda ENIs 
# DBPROXY_ARN, DBPROXY_NAME, DB_PROXY_ENDPOINT -> RDS DB Proxy information 
# DB: database to connect to 
# SCHEMAS -> schemas that contain the tables you want to include in the schema
# DB_USERNAME -> database username 
# BUCKET_NAME -> bucket used to temporarily store schema cache

cdk deploy --hotswap --watch -c vpcId=$VPC_ID -c subnetIds=$SUBNET_ID \
--parameters assetBucketName=$BUCKET_NAME \
--parameters sgId=$SG_ID \
--parameters dbProxyArn=$DBPROXY_ARN \
--parameters dbProxyName=$DBPROXY_NAME \
--parameters dbProxyEndpoint=$DB_PROXY_ENDPOINT \
--parameters database=$DB \
--parameters schemas=$SCHEMAS \
--parameters userName=$DB_USERNAME \
```
