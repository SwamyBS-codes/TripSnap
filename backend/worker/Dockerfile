FROM node:20-alpine AS build
RUN apk add --no-cache vips-dev
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
CMD ["npm","start"]
