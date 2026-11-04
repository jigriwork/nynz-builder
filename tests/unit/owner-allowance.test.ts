import {afterEach,describe,expect,it,vi} from "vitest";
import type {SupabaseClient} from "@supabase/supabase-js";
import {ensureTrialCredits} from "../../lib/billing/entitlements";
afterEach(()=>vi.unstubAllEnvs());
function client(role:string|null,error:unknown=null){const rpc=vi.fn().mockResolvedValue({error:null});const db={rpc,from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:role?{role}:null,error})})})})};return {db:db as unknown as SupabaseClient,rpc};}
describe("explicit owner allowance",()=>{
 it("does not silently add trial credits to an owner",async()=>{vi.stubEnv("TRIAL_CREDITS","25");const {db,rpc}=client("owner");await ensureTrialCredits(db,"owner");expect(rpc).not.toHaveBeenCalled();});
 it("retains the idempotent customer welcome grant",async()=>{vi.stubEnv("TRIAL_CREDITS","25");const {db,rpc}=client(null);await ensureTrialCredits(db,"customer");expect(rpc).toHaveBeenCalledWith("grant_credits",expect.objectContaining({p_user:"customer",p_amount:25,p_idempotency:"trial:customer"}));});
 it("does not guess an account's role when the permission lookup fails",async()=>{vi.stubEnv("TRIAL_CREDITS","25");const {db,rpc}=client(null,new Error("database unavailable"));await expect(ensureTrialCredits(db,"owner")).rejects.toThrow("database unavailable");expect(rpc).not.toHaveBeenCalled();});
});
