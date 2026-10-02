FROM ghcr.io/goauthentik/server:2026.8.3@sha256:ab9b4e8cc4ab3f8d1198d2db6aeea66bafea1963b3f2843589e0d163f97d9849
USER root
RUN mkdir -p /data /templates /certs /opt/recipe \
    && chown root:root /data /templates /certs \
    && chmod 0555 /data /templates /certs
COPY --chown=root:root runtime/ /opt/recipe/
COPY LICENSE /opt/recipe/LICENSE
USER 1000
ENTRYPOINT ["dumb-init", "--", "python", "/opt/recipe/runtime.py"]
CMD ["server"]
HEALTHCHECK --interval=10s --timeout=15s --start-period=120s --retries=12 CMD ["python", "/opt/recipe/runtime.py", "check"]
