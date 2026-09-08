import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

let mongod: MongoMemoryServer | undefined;

export async function startInMemoryMongo(): Promise<string> {
  mongod = await MongoMemoryServer.create();
  return mongod.getUri();
}

export async function stopInMemoryMongo(): Promise<void> {
  await mongoose.disconnect();
  if (mongod) {
    await mongod.stop();
    mongod = undefined;
  }
}

export async function clearInMemoryMongo(): Promise<void> {
  // NestJS's MongooseModule.forRootAsync connects via `mongoose.createConnection()`, which
  // creates a brand-new Connection pushed onto `mongoose.connections` - it is NOT the same
  // object as the `mongoose.connection` singleton getter (that always returns `connections[0]`,
  // an idle default connection nothing in this app ever uses). Clearing only
  // `mongoose.connection.collections` was therefore a no-op against the app's real data; every
  // ready connection needs to be cleared instead.
  const readyConnections = mongoose.connections.filter((connection) => connection.readyState === 1);
  await Promise.all(
    readyConnections.map(async (connection) => {
      const collections = connection.collections;
      await Promise.all(Object.values(collections).map((collection) => collection.deleteMany({})));
    }),
  );
}
