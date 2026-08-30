FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

RUN mkdir -p /data/uploads

ENV PORT=10000
ENV DATA_DIR=/data
ENV UPLOAD_DIR=/data/uploads

EXPOSE 10000

CMD ["npm", "start"]
