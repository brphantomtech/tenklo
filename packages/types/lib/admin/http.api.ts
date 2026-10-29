import type { ApiEndpoint, ApiError } from '../index.js';

export type PostImpersonate = ApiEndpoint<{
    Audit: { kind: 'no-audit'; reason: 'TODO: audit coverage pending' };
    Method: 'POST';
    Path: `/api/v1/admin/impersonate`;
    Querystring: {
        env: string;
    };
    Body: {
        accountUUID: string;
        loginReason: string;
        code?: string | undefined;
    };
    Error: ApiError<'invalid_mfa_code'> | ApiError<'mfa_code_required'> | ApiError<'mfa_not_enabled'>;
    Success: { success: true };
}>;

export type PutAdminBillingExempt = ApiEndpoint<{
    Audit: { kind: 'no-audit'; reason: 'TODO: audit coverage pending' };
    Method: 'PUT';
    Path: `/api/v1/admin/accounts/:accountId/billing-exempt`;
    Querystring: {
        env: string;
    };
    Params: {
        accountId: number;
    };
    Body: {
        exempt: boolean;
    };
    Error: ApiError<'unknown_account'>;
    Success: { data: { accountId: number; billingExempt: boolean } };
}>;
