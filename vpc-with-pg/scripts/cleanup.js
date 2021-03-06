const config = require('../output.json')
const aws = require('aws-sdk')
const lambdaClient = new aws.Lambda({ region: config.PgSchemaStack.REGION })

async function run() {
  const result = await lambdaClient
    .invoke({
      FunctionName: config.PgSchemaStack.dbSchemaHandlerName,
      Payload: JSON.stringify({ cleanup: true }),
    })
    .promise()
  console.log(result)
}

console.log('Cleaning up database')
run()
