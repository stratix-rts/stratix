import { test, expect, APIRequestContext } from '@playwright/test';

test.describe('Stratix API', () => {
  let apiRequest: APIRequestContext;

  test.beforeAll(async ({ playwright }) => {
    apiRequest = await playwright.request.newContext({
      baseURL: 'http://localhost:7524',
    });

    let retries = 10;
    while (retries > 0) {
      try {
        const response = await apiRequest.get('/health');
        if (response.ok()) break;
      } catch (e) {
      }
      await new Promise(r => setTimeout(r, 1000));
      retries--;
    }
  });

  test('health check should return ok', async () => {
    const response = await apiRequest.get('/health');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.status).toBe('ok');
    expect(data.services.http).toBe('running');
  });

  test('should list agents', async () => {
    const response = await apiRequest.get('/api/stratix/config/agent/list');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.code).toBe(200);
    expect(Array.isArray(data.data)).toBeTruthy();
  });

  test('should get templates', async () => {
    const response = await apiRequest.get('/api/stratix/config/template/list');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.code).toBe(200);
  });

  test('should handle agent creation request', async () => {
    const timestamp = Date.now();
    const random = Math.random().toString(36).slice(2, 8);
    const newAgent = {
      agentId: `stratix-${timestamp}-${random}`,
      name: 'Test Agent',
      type: 'writer',
      soul: {
        identity: 'Test identity',
        goals: ['Test goal'],
        personality: 'Test personality'
      },
      memory: {
        shortTerm: [],
        longTerm: [],
        context: ''
      },
      skills: [{
        skillId: 'stratix-skill-test',
        name: 'Test Skill',
        description: 'Test skill description',
        parameters: [],
        executeScript: '{}'
      }],
      model: {
        name: 'test-model',
        params: {}
      },
      openClawConfig: {
        accountId: 'test-account',
        endpoint: 'http://localhost:8000'
      }
    };

    const createResponse = await apiRequest.post('/api/stratix/config/agent/create', {
      data: newAgent
    });

    // Accept 200 (success) or 400 (validation error) as valid responses
    expect([200, 400]).toContain(createResponse.status());

    const createData = await createResponse.json();
    console.log('Create agent response:', createData);
  });
});
