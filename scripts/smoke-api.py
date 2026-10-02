import json
import os
import sys
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen


BASE = "http://127.0.0.1:18423"
TOKEN = os.environ["AUTHENTIK_BOOTSTRAP_TOKEN"]


def request(path, payload=None, method=None, authenticated=True):
    headers = {"Accept": "application/json"}
    if authenticated:
        headers["Authorization"] = f"Bearer {TOKEN}"
    if payload is not None:
        headers["Content-Type"] = "application/json"
    data = json.dumps(payload).encode() if payload is not None else None
    with urlopen(Request(BASE + path, data=data, headers=headers, method=method), timeout=15) as response:
        body = response.read()
        return json.loads(body) if body else None


def wait(predicate, message, timeout=180):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            print(f"PASS: {message}", flush=True)
            return
        time.sleep(2)
    raise TimeoutError(message)


def worker_application():
    content = """version: 1
metadata:
  name: Recipe smoke worker application
entries:
  - model: authentik_core.application
    identifiers:
      slug: recipe-smoke-app
    attrs:
      name: Recipe smoke application
"""
    blueprint = request("/api/v3/managed/blueprints/", {"name": "Recipe smoke worker application", "path": "", "content": content, "enabled": True})
    request(f"/api/v3/managed/blueprints/{blueprint['pk']}/apply/", {}, method="POST")
    wait(lambda: request("/api/v3/core/applications/?slug=recipe-smoke-app")["pagination"]["count"] == 1, "HTTP API → PostgreSQL queue → private worker → application")
    assert request(f"/api/v3/managed/blueprints/{blueprint['pk']}/")["status"] == "successful"


def oidc_discovery():
    authorization = request("/api/v3/flows/instances/?slug=default-provider-authorization-explicit-consent")["results"][0]["pk"]
    invalidation = request("/api/v3/flows/instances/?slug=default-provider-invalidation-flow")["results"][0]["pk"]
    certificates = request("/api/v3/crypto/certificatekeypairs/")["results"]
    assert certificates, "Upstream signing certificate must be generated in SQL"
    provider = request("/api/v3/providers/oauth2/", {
        "name": "Recipe smoke OIDC", "authorization_flow": authorization, "invalidation_flow": invalidation,
        "client_type": "public", "client_id": "recipe-smoke-client",
        "redirect_uris": [{"matching_mode": "strict", "url": BASE + "/callback"}],
        "signing_key": certificates[0]["pk"],
    })
    request("/api/v3/core/applications/recipe-smoke-app/", {"provider": provider["pk"]}, method="PATCH")
    discovery = request("/application/o/recipe-smoke-app/.well-known/openid-configuration", authenticated=False)
    assert discovery["issuer"] == BASE + "/application/o/recipe-smoke-app/"
    assert discovery["authorization_endpoint"].startswith(BASE)
    assert request("/application/o/recipe-smoke-app/jwks/", authenticated=False)["keys"]
    print("PASS: configured OIDC discovery and SQL-stored signing certificate JWKS (not authorization-code federation)")


def verify_setup_closed():
    result = request("/api/v3/flows/executor/initial-setup/", authenticated=False)
    assert result.get("component") == "ak-stage-access-denied", f"Setup is not denied: {result.get('component')}"
    print("PASS: unauthenticated initial setup is denied")


def main():
    phase = sys.argv[1]
    if phase == "fresh":
        current = request("/api/v3/core/users/me/")
        assert current["user"]["username"] == "akadmin"
        assert current["user"]["is_superuser"]
        verify_setup_closed()
        worker_application()
        oidc_discovery()
        print("PASS: fresh bootstrap token authenticates privileged administrator")
    elif phase == "persisted":
        assert request("/api/v3/core/applications/?slug=recipe-smoke-app")["pagination"]["count"] == 1
        assert request("/application/o/recipe-smoke-app/jwks/", authenticated=False)["keys"]
        verify_setup_closed()
        print("PASS: application and SQL signing certificate persisted after restart/restore")
    elif phase == "revoke":
        token = request("/api/v3/core/tokens/?identifier=authentik-bootstrap-token")["results"][0]
        request(f"/api/v3/core/tokens/{token['identifier']}/", method="DELETE")
        try:
            request("/api/v3/core/users/me/")
        except HTTPError as error:
            assert error.code in (401, 403)
        else:
            raise AssertionError("Revoked bootstrap token still authenticates")
        print("PASS: bootstrap token revoked and old API credential rejected")
    elif phase == "after-revoke":
        assert request("/application/o/recipe-smoke-app/jwks/", authenticated=False)["keys"]
        verify_setup_closed()
        print("PASS: restart and discovery work after bootstrap token revocation")
    else:
        raise ValueError("Unknown smoke phase")


if __name__ == "__main__":
    main()
