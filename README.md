![Example](/apps/server/assets/ignore/banner.png)

# Monotopia

> A Growtopia private server built with Node.js and Bun.js, powered by [growtopia.js](https://github.com/JadlionHD/growtopia.js)
>
> Monotopia is a maintained clone/refactor of [GrowServer](https://github.com/StileDevs/GrowServer) by StileDevs. Original work and contributors are credited through the upstream project.

> [!NOTE]
> This source is not production ready yet. In the future it will be using a [Docker](#docker) to deploy the server, feel free to join [Discord Server](https://discord.gg/sGrxfKZY5t) to discuss regarding this.

## Requirements

- [Node.js](https://nodejs.org) v20.19+ or [Bun.js](https://bun.sh) v1.2.9+
- [pnpm](https://pnpm.io) v10.34+
- [mkcert](https://github.com/FiloSottile/mkcert)
- [docker](https://docker.com/)
- [docker-compose](https://docs.docker.com/compose/) (required)

## Setup

To setup the server, first install necessary packages & settings by

```
$ pnpm install
$ pnpm run setup
```

And congrats setup are done, simple as that!
Now you just need to run the server by

> [!NOTE]
> It must be running PostgreSQL & Redis in background by using docker, please navigate to [docker](#docker) guide

```
$ pnpm run dev
```

## Database

Database that we moved to PostgreSQL from previous database SQLite.
And for the ORM we are using [Drizzle-ORM](https://orm.drizzle.team/)

To view the database you can run this command below:

```
$ pnpm run studio
```

and access it on here https://local.drizzle.studio/

## Starting server

To run the development server by

```
$ pnpm run start
```

## Development

In order to make new login system work you need to install [mkcert](https://github.com/FiloSottile/mkcert) on this [download page](https://github.com/FiloSottile/mkcert/releases) (I'd recommend using [Lets encrypt](https://letsencrypt.org/getting-started/) for production only)

### Local CA installation

Install the mkcert local CA by

```
$ mkcert -install
```

### Hosts

For the hosts file you can see this example below

```
127.0.0.1 www.growtopia1.com
127.0.0.1 www.growtopia2.com
127.0.0.1 login.monotopia.app
```

## Docker

To run the dockerized & running it automatically just run

```sh
docker compose up -d
```

or you want to run the database & redis only (this were for development only) then simply running

```sh
docker compose up -d db redis
```

## Contributing

Any contributions are welcome.

There's few rules of contributing:

- Code must match the existing code style. Please make sure to run `pnpm run lint` before submiting a PR.
- The commit must take review first before merging into `main` branch.

## Links

- [Discord Server](https://discord.gg/sGrxfKZY5t)

## Original Contributors

Give a thumbs to these cool contributors:

<a href="https://github.com/StileDevs/GrowServer">
  <img src="https://contrib.rocks/image?repo=StileDevs/GrowServer"/>
</a>
