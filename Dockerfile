FROM node:22-slim
RUN corepack enable
WORKDIR /app
COPY . .
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm install --frozen-lockfile && pnpm --filter @solver/web build
EXPOSE 3000 4000
CMD ["sh", "-c", "PORT=4000 pnpm --filter @solver/worker start & pnpm --filter @solver/web start"]
