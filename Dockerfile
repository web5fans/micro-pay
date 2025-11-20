FROM node:24-alpine

ARG NODE_ENV=production
ENV NODE_ENV $NODE_ENV
COPY package.json .
RUN npm install\
    && npm install typescript -g
COPY . .
RUN tsc
CMD ["node", "dist/index.js"]