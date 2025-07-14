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
    const config: StackOutput = JSON.parse(readFileSync('../output.json', 'utf8'));
    
    const lambdaClient = new LambdaClient({ 
      region: config.PgSchemaStack.Region 
    });

    const command = new InvokeCommand({
      FunctionName: config.PgSchemaStack.dbSchemaHandlerName,
      Payload: JSON.stringify({ cleanup: true }),
    });

    const result = await lambdaClient.send(command);
    
    console.log('Lambda execution result:', result);
    
    if (result.Payload) {
      const payload = JSON.parse(new TextDecoder().decode(result.Payload));
      console.log('Function response:', payload);
    }
  } catch (error) {
    console.error('Error cleaning up database:', error);
    process.exit(1);
  }
}

console.log('Cleaning up database...');
run();