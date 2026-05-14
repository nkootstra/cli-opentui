const { OAuth2Server } = require("oauth2-mock-server");

const server = new OAuth2Server();

server.service.on("beforeUserinfo", (userInfoResponse, _req) => {
  userInfoResponse.body = {
    sub: "dev-user",
    email: "dev@localhost",
    email_verified: true,
    name: "Dev User",
  };
});

const port = Number(process.env.PORT ?? 8080);
const address = process.env.ADDRESS ?? "0.0.0.0";

server.issuer.keys.generate("RS256").then(() =>
  server.start(port, address)
).then(() => {
  console.log(`OAuth 2 server listening on http://${address}:${port}`);
  console.log(`OAuth 2 issuer is http://localhost:${port}`);
});
