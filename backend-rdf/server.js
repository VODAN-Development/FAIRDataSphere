import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@as-integrations/express5';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import http from 'http';
import { findUserById } from './auth/authStore.js';
import { sessionCookieName, verifySessionToken } from './auth/tokens.js';
import typeDefs from './schema/typeDefs.js';
import resolvers from './resolvers/index.js';

const PORT = process.env.PORT || 4000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';

async function currentUserFromRequest(req) {
  const session = verifySessionToken(req.cookies?.[sessionCookieName()]);
  if (!session?.sub) return null;
  return findUserById(session.sub);
}

const app = express();
const httpServer = http.createServer(app);

const server = new ApolloServer({
  typeDefs,
  resolvers,
  plugins: [ApolloServerPluginDrainHttpServer({ httpServer })],
});
await server.start();

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.use(
  '/graphql',
  cors({
    origin: FRONTEND_ORIGIN,
    credentials: true,
  }),
  cookieParser(),
  express.json(),
  expressMiddleware(server, {
    context: async ({ req, res }) => ({
      currentUser: await currentUserFromRequest(req),
      req,
      res,
    }),
  }),
);

await new Promise(resolve => httpServer.listen({ port: PORT }, resolve));
console.log(`Server ready at http://localhost:${PORT}/graphql`);
