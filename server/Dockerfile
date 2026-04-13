FROM debian:bookworm

RUN apt-get update && apt-get install -y --no-install-recommends g++ cmake make libboost-system-dev

WORKDIR /app
COPY . .

RUN cmake . && make

CMD ["./server"]