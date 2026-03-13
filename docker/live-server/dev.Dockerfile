FROM rust:1-slim

RUN apt-get update && \
    apt-get install -y protobuf-compiler && \
    rm -rf /var/lib/apt/lists/* && \
    cargo install cargo-watch
