import { readFileSync } from 'fs';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

interface StackOutput {
  PgSchemaStack: {
    dbSchemaHandlerName: string;
    Region: string;
  };
}

async function run(): Promise<void> {
  try {
    const config: StackOutput = JSON.parse(readFileSync('output.json', 'utf8'));
    
    const lambdaClient = new LambdaClient({ 
      region: config.PgSchemaStack.Region 
    });

    const command = new InvokeCommand({
      FunctionName: config.PgSchemaStack.dbSchemaHandlerName,
      Payload: JSON.stringify({ cleanup: false }), // load data, don't cleanup
    });

    const result = await lambdaClient.send(command);
    
    console.log('Lambda execution result:', result);
    
    if (result.Payload) {
      const payload = JSON.parse(new TextDecoder().decode(result.Payload));
      console.log('Function response:', payload);
    }
  } catch (error) {
    console.error('Error loading data:', error);
    process.exit(1);
  }
}

console.log('Loading sample data into database...');
run();