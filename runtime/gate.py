import hashlib
import hmac
import os

import psycopg


CONTRACT = "authentik-oidc-broker/bootstrap-v1"


def connect():
    return psycopg.connect(
        host=os.environ["AUTHENTIK_POSTGRESQL__HOST"],
        port=int(os.environ.get("AUTHENTIK_POSTGRESQL__PORT", "5432")),
        dbname=os.environ.get("AUTHENTIK_POSTGRESQL__NAME", "authentik"),
        user=os.environ.get("AUTHENTIK_POSTGRESQL__USER", "authentik"),
        password=os.environ["AUTHENTIK_POSTGRESQL__PASSWORD"],
        sslmode=os.environ.get("AUTHENTIK_POSTGRESQL__SSLMODE", "disable"),
        connect_timeout=5,
        options="-c statement_timeout=5000 -c lock_timeout=3000",
    )


def fingerprint():
    return hashlib.sha256(os.environ["AUTHENTIK_SECRET_KEY"].encode()).hexdigest()


def read_marker(connection):
    if not connection.execute(
        "SELECT to_regclass('public.railway_recipe_bootstrap')"
    ).fetchone()[0]:
        return None
    return connection.execute(
        "SELECT secret_fingerprint FROM public.railway_recipe_bootstrap WHERE contract = %s",
        (CONTRACT,),
    ).fetchone()


def approved(connection):
    marker = read_marker(connection)
    if marker is None:
        return False
    if not hmac.compare_digest(marker[0], fingerprint()):
        raise RuntimeError("Signing secret differs from the durable bootstrap gate")
    return True


def bootstrap_ready(connection):
    from django.conf import settings
    from django.contrib.auth.hashers import check_password

    if not settings.configured:
        settings.configure()
    account = connection.execute(
        """SELECT account.password, account.email FROM authentik_core_user account
        WHERE account.username = 'akadmin' AND account.is_active = true
        AND EXISTS (SELECT 1 FROM authentik_core_user_groups membership
                    JOIN authentik_core_group admin_group ON admin_group.group_uuid = membership.group_id
                    WHERE membership.user_id = account.id AND admin_group.is_superuser = true)"""
    ).fetchone()
    if not account or account[1] != os.environ["AUTHENTIK_BOOTSTRAP_EMAIL"]:
        return False
    if not check_password(os.environ["AUTHENTIK_BOOTSTRAP_PASSWORD"], account[0]):
        return False
    token = connection.execute(
        """SELECT token.key FROM authentik_core_token token
        JOIN authentik_core_user account ON account.id = token.user_id
        WHERE token.identifier = 'authentik-bootstrap-token' AND token.intent = 'api'
        AND token.expiring = false AND account.username = 'akadmin'"""
    ).fetchone()
    if not token or not hmac.compare_digest(token[0], os.environ["AUTHENTIK_BOOTSTRAP_TOKEN"]):
        return False
    flows = connection.execute(
        """SELECT count(*) FROM authentik_flows_flow
        WHERE slug IN ('default-authentication-flow', 'default-provider-authorization-explicit-consent',
                       'default-provider-invalidation-flow')"""
    ).fetchone()[0]
    blueprints = connection.execute(
        """SELECT count(*) FROM authentik_blueprints_blueprintinstance
        WHERE path IN ('default/flow-default-authentication-flow.yaml',
                       'default/flow-default-provider-authorization-explicit-consent.yaml',
                       'default/flow-default-provider-invalidation.yaml')
        AND enabled = true AND status = 'successful'"""
    ).fetchone()[0]
    return flows == 3 and blueprints == 3


def commit_marker(connection):
    connection.execute("SELECT pg_advisory_xact_lock(18423801)")
    connection.execute(
        """CREATE TABLE IF NOT EXISTS public.railway_recipe_bootstrap (
        contract text PRIMARY KEY,
        secret_fingerprint text NOT NULL,
        completed_at timestamptz NOT NULL DEFAULT now())"""
    )
    if approved(connection):
        return True
    if not bootstrap_ready(connection):
        return False
    connection.execute(
        "INSERT INTO public.railway_recipe_bootstrap (contract, secret_fingerprint) VALUES (%s, %s)",
        (CONTRACT, fingerprint()),
    )
    return True
