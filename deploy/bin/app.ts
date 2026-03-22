#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { DailyOrbitStack } from '../lib/stack.js';
import { loadSeedConfig } from '../lib/config.js';

const app: App = new App();
const config = loadSeedConfig();

new DailyOrbitStack(app, config.stackName, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  config,
});

app.synth();
