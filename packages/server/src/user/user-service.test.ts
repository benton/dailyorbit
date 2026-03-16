import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SecretValue } from '../lib/encryption.ts';
import { ensureAuthTables } from './schema.ts';
import { UserService } from './user-service.ts';

describe('UserService', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;
  let service: UserService;

  const testPassword: SecretValue = new SecretValue('test-password-123');

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await ensureAuthTables(conn);
    service = new UserService(db);
  });

  afterEach(() => {
    conn.closeSync();
  });

  describe('createUser', () => {
    it('auto-promotes first user to admin', async () => {
      const user = await service.createUser(
        'admin@test.com',
        'Admin',
        testPassword,
      );
      expect(user.role).toEqual('admin');
      expect(user.email).toEqual('admin@test.com');
      expect(user.name).toEqual('Admin');
      expect(user.banned).toEqual(false);
    });

    it('assigns user role to subsequent users', async () => {
      await service.createUser('first@test.com', 'First', testPassword);
      const second = await service.createUser(
        'second@test.com',
        'Second',
        testPassword,
      );
      expect(second.role).toEqual('user');
    });

    it('respects explicit role override', async () => {
      await service.createUser('first@test.com', 'First', testPassword);
      const admin = await service.createUser(
        'admin2@test.com',
        'Admin2',
        testPassword,
        'admin',
      );
      expect(admin.role).toEqual('admin');
    });
  });

  describe('getUserCount', () => {
    it('returns 0 for empty database', async () => {
      const count: number = await service.getUserCount();
      expect(count).toEqual(0);
    });

    it('returns correct count after creating users', async () => {
      await service.createUser('a@test.com', 'A', testPassword);
      await service.createUser('b@test.com', 'B', testPassword);
      const count: number = await service.getUserCount();
      expect(count).toEqual(2);
    });
  });

  describe('listUsers', () => {
    it('returns all users', async () => {
      await service.createUser('a@test.com', 'A', testPassword);
      await service.createUser('b@test.com', 'B', testPassword);
      const users = await service.listUsers();
      expect(users.length).toEqual(2);
    });
  });

  describe('getUser / getUserByEmail', () => {
    it('returns user by id', async () => {
      const created = await service.createUser(
        'test@test.com',
        'Test',
        testPassword,
      );
      const found = await service.getUser(created.id);
      expect(found).not.toBeNull();
      expect(found!.email).toEqual('test@test.com');
    });

    it('returns null for unknown id', async () => {
      const found = await service.getUser('nonexistent');
      expect(found).toBeNull();
    });

    it('returns user by email', async () => {
      await service.createUser('test@test.com', 'Test', testPassword);
      const found = await service.getUserByEmail('test@test.com');
      expect(found).not.toBeNull();
      expect(found!.name).toEqual('Test');
    });
  });

  describe('disableUser / enableUser', () => {
    it('disables and enables a user', async () => {
      const user = await service.createUser(
        'test@test.com',
        'Test',
        testPassword,
      );

      await service.disableUser(user.id, 'policy violation');
      let found = await service.getUser(user.id);
      expect(found!.banned).toEqual(true);
      expect(found!.banReason).toEqual('policy violation');

      await service.enableUser(user.id);
      found = await service.getUser(user.id);
      expect(found!.banned).toEqual(false);
      expect(found!.banReason).toBeNull();
    });
  });

  describe('deleteUser', () => {
    it('removes user and associated records', async () => {
      const user = await service.createUser(
        'test@test.com',
        'Test',
        testPassword,
      );
      await service.deleteUser(user.id);

      const found = await service.getUser(user.id);
      expect(found).toBeNull();

      const count: number = await service.getUserCount();
      expect(count).toEqual(0);
    });
  });

  describe('setRole', () => {
    it('changes user role', async () => {
      const user = await service.createUser(
        'test@test.com',
        'Test',
        testPassword,
      );
      // First user is auto-admin
      expect(user.role).toEqual('admin');

      await service.setRole(user.id, 'user');
      const found = await service.getUser(user.id);
      expect(found!.role).toEqual('user');
    });
  });
});
