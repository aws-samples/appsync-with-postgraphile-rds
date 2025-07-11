import { readFileSync } from 'fs';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

interface StackOutput {
  AppSyncWithPostgraphileStack: {
    providerName: string;
  };
}

async function run(): Promise<void> {
  try {
    const config: StackOutput = JSON.parse(readFileSync('output.json', 'utf8'));
    
    const lambdaClient = new LambdaClient({ 
      region: 'us-east-1' 
    });

    const command = new InvokeCommand({
      FunctionName: config.AppSyncWithPostgraphileStack.providerName,
    });

    const result = await lambdaClient.send(command);
    
    console.log('Lambda execution result:', result);
    
    if (result.Payload) {
      const payload = JSON.parse(new TextDecoder().decode(result.Payload));
      console.log('Function response:', payload);
    }
  } catch (error) {
    console.error('Error updating GraphQL schema:', error);
    process.exit(1);
  }
}

console.log('Preparing Direct Lambda Resolver and AppSync API...');
run();