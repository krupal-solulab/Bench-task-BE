import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { API_PREFIX, authHeader } from './test-app';

/** Thin wrappers around the real HTTP API so specs can build fixtures without re-typing routes. */

// The response bodies these helpers return are arbitrary, deeply-nested API JSON (project/task
// DTOs with populated refs) that specs access loosely (`.owner.id`, `.assignee.id`, `.members`,
// ...). Modelling the exact shape here would just duplicate the service response interfaces;
// `any` is the same documented escape hatch already used for schema `toJSON` transforms.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiRecord = Record<string, any>;

export function api(app: INestApplication) {
  return request(app.getHttpServer());
}

export async function createProject(
  app: INestApplication,
  token: string,
  body: Record<string, unknown>,
): Promise<ApiRecord> {
  const res = await api(app)
    .post(`/${API_PREFIX}/projects`)
    .set(...authHeader(token))
    .send(body);
  if (res.status !== 201) {
    throw new Error(`createProject failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data;
}

export async function createTask(
  app: INestApplication,
  token: string,
  body: Record<string, unknown>,
): Promise<ApiRecord> {
  const res = await api(app)
    .post(`/${API_PREFIX}/tasks`)
    .set(...authHeader(token))
    .send(body);
  if (res.status !== 201) {
    throw new Error(`createTask failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data;
}

export async function addMembers(
  app: INestApplication,
  token: string,
  projectId: string,
  userIds: string[],
): Promise<ApiRecord> {
  const res = await api(app)
    .post(`/${API_PREFIX}/projects/${projectId}/members`)
    .set(...authHeader(token))
    .send({ userIds });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`addMembers failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data;
}
