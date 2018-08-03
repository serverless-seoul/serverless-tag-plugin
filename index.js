'use strict';

/**
 * This Serverless Plugin add tags for API G/W and Lambda resources
 */

const util = require('util');

class ServerlessPlugin {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;
    this.provider = this.serverless.getProvider(this.serverless.service.provider.name);

    const { service } = this.serverless;

    this.data = {
      serviceName: this.serverless.service.service,
      region: this.options.region || service.provider.region,
      stage: this.options.stage || service.provider.stage,
    };

    // Check Provideer
    if (service.provider.name === 'aws') {
      this.hooks = {
        'before:package:setupProviderConfiguration': this.beforeSetupProviderConfiguration.bind(this),
        'after:deploy:deploy': this.afterDeploy.bind(this)
      };
    } else {
      this.log('Detected non-aws envirionment. skipping...');
    }
  }

  async getApiId(stage) {
    const [ stack ] = (await this.provider.request('CloudFormation', 'describeStacks', {
      StackName: this.provider.naming.getStackName(stage),
    })).Stacks;

    const stackOutputs = stack.Outputs;

    const apiEndpointUrls = stackOutputs
      .filter((output) => output.OutputKey.includes('ServiceEndpoint'))
      .map((output) => output.OutputValue);

    const apiIds = apiEndpointUrls.map((endpointUrl) => {
      const [ , apiId ] = endpointUrl.match('https:\/\/(.*)\\.execute-api');

      return apiId;
    });

    return apiIds[0];
  }

  beforeSetupProviderConfiguration() {
    this.log('Injecting service-level function tags...');

    const { service } = this.serverless;

    // Check tags field has defined
    if (!service.provider.tags) {
      this.log('Detected provider.tags definition is missing, injecting empty object...');
      service.provider.tags = {};
    }

    if (service.provider.tags.SERVICE_NAME) {
      this.log('CAUTION! SERVICE_NAME on service-level tag is already defined! it will be overwritten!')
    }

    Object.assign(service.provider.tags, {
      SERVICE_NAME: this.data.serviceName,
    });

    this.log('Injected service-level function tags: ', service.provider.tags);

    this.log('Injecting function-level function tags...');

    Object.keys(service.functions).forEach((functionName) => {
      const functionDef = service.functions[functionName];

      if (!functionDef.tags) {
        this.log('Detected tags definition on "%s" function is missing. injecting empty object...', functionName);
        functionDef.tags = {};
      }

      if (functionDef.tags.Name) {
        this.log('CAUTION! Function "%s" already have Name tag. It will be overwritten!', functionName);
      }

      Object.assign(functionDef.tags, {
        Name: `${this.data.serviceName}-${functionName}:${this.data.stage}:${this.data.region}`
      });

      this.log('Injected function tags: ', functionDef.tags);
    });
  }

  async afterDeploy() {
    this.log('Getting deployed apiId');
    const apiId = await this.getApiId(this.data.stage);

    this.log('Tagging API Gateway resource... (apiId: %s)', apiId);

    await this.provider.request('APIGateway', 'tagResource', {
      resourceArn: `arn:aws:apigateway:${this.data.region}::/restapis/${apiId}/stages/${this.data.stage}`,
      tags: {
        Name: `${this.data.serviceName}:${this.data.stage}:${this.data.region}`,
        SERVICE_NAME: this.data.serviceName,
      },
    });

    this.log('Done');
  }

  log(...args) {
    if (typeof args[0] === 'string') {
      args[0] = `@vingle/serverless-tags ${args[0]}`;
    } else {
      args.unshift(`@vingle/serverless-tags`);
    }

    this.serverless.cli.log(util.format(...args));
  }
}

module.exports = ServerlessPlugin;
