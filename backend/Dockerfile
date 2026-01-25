FROM node:20

WORKDIR /app

COPY . .

RUN npm install --legacy-peer-deps
RUN npm run build

EXPOSE 3001

CMD ["npm", "start"]
