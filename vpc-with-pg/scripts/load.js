const config = require('../output.json')
const aws = require('aws-sdk')
const lambdaClient = new aws.Lambda({ region: config.PgSchemaStack.REGION })

async function run() {
  const result = await lambdaClient.invoke({ FunctionName: config.PgSchemaStack.dbSchemaHandlerName }).promise()
  console.log(result)
}

console.log('Loading database')
run()
