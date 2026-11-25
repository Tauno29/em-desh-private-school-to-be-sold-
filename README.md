# Welcome to your Lovable project

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Open your project in the [Lovable editor](https://lovable.dev) and keep building.

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: connect the project to GitHub and every change made in Lovable is committed straight to your repository.
- **Full ownership**: this code is yours. Push to your repository and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Netlify deployment

Netlify publishes the static school site directly from `public/`, including its
redirects and headers. The Netlify build command only checks that the homepage
exists; it does not run the TanStack Start build. The public site continues to
use the Lovable-hosted school services, and `bun run build` remains available
for the Lovable deployment.

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS
