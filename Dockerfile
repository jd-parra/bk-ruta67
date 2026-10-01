# Backend de Pasaje para cualquier proveedor con Docker (Render, Railway, Fly.io o un VPS).
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY shared ./shared
COPY scripts ./scripts

EXPOSE 3000
# Aplica las migraciones pendientes y arranca (el proveedor pasa PORT).
CMD ["npm", "run", "start:servidor"]
