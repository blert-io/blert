import express from 'express';

async function main() {
  const app = express();
  const port = process.env.PORT || 3009;

  app.get('/ping', (_req, res) => {
    res.send('pong');
  });

  app.listen(port, () => {
    console.log(`Challenge server started on port ${port}`);
  });
}

main();
