FROM rust:1.79-alpine as builder

RUN apk add --no-cache musl-dev sqlite-dev

WORKDIR /app
COPY Cargo.toml ./
COPY src ./src

RUN cargo build --release

FROM alpine:3.19
RUN apk add --no-cache sqlite-libs ca-certificates
WORKDIR /app
COPY --from=builder /app/target/release/sss-backend .

ENV LISTEN_ADDR=0.0.0.0:3000
ENV DATABASE_URL=/data/sss.db
ENV RUST_LOG=info

EXPOSE 3000
VOLUME ["/data"]
CMD ["./sss-backend"]
