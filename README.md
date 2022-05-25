# AppSync - RDS-as-a-Datasource with postgraphile

Monorepo Index
- vpc-with-pg
- pg-with-graphile

## set up

```sh
git clone https://x/pg-with-graphile-as-a-datasource.git
cd pg-with-graphile-as-a-datasource
npm install
```

## VPC with RDS
if you do not have an existing PostgreSQL RDS, the **vpc-with-pg** will deploy the minimum for a VPC with public and private subnets with NAT Gateway and provision an RDS  instance into the private subnet.

### Deploy

From the root of **vpc-with-pg**:

```sh
cd ./vpc-with-pg
npm run cdk deploy -- --all -O output.json
cd ..
```

>> TODO: add sample data

## PG with Graphile
to deploy graphile into an existing vpc with RDS, or after **vpc-with-pg** 

You must use RDS Proxy with IAM authorization.
https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-proxy.html
## deploy

Use the `deploy` script to help configure your context and parameters. The script uses values from **vpc-with-pg**'s `output.json`.

```bash
cd ./pg-with-graphile
npm run deploy -- --username <username> --database <database> --schemas <schemas>
```

Deploy using the outputed `cdk deploy` command.

After deployment, run the `update` script to update your API and create your schema cache layer

```bash
npm run update
```

Done.
## Clean up

```sh
cd ./pg-with-graphile
npm run cdk destroy
cd ./vpc-with-pg
npm run cdk destroy -- --all
```
