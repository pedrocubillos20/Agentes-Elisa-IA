import request from 'supertest';

// Mock prisma before importing app
jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $disconnect: jest.fn(),
  }
}));

import app from '../server';
import prisma from '../lib/prisma';

describe('Auth - POST /api/auth/login', () => {
  it('debe rechazar login sin email', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ password: 'test1234' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('issues');
  });

  it('debe rechazar login con email inválido', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'no-es-email', password: 'test1234' });
    expect(res.status).toBe(400);
  });

  it('debe rechazar login con credenciales incorrectas', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'wrongpass' });
    expect(res.status).toBe(401);
  });
});

describe('Auth - POST /api/auth/register', () => {
  it('debe rechazar registro con password corto', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'test@example.com', password: '123', name: 'Test' });
    expect(res.status).toBe(400);
    expect(res.body.issues.some((i: any) => i.field === 'password')).toBe(true);
  });
});
