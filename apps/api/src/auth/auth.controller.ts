import { Body, Controller, HttpCode, HttpException, Post } from "@nestjs/common";

// 自建注册：用 service_role 直接创建「已确认」账号，绕开不可靠的确认邮件流程。
// 这样注册即可立即登录；重复邮箱返回明确错误。
@Controller("auth")
export class AuthController {
  @Post("register")
  @HttpCode(200)
  async register(@Body() body: { email?: string; password?: string }) {
    const email = (body?.email || "").trim().toLowerCase();
    const password = body?.password || "";

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new HttpException({ code: "INVALID_EMAIL" }, 400);
    }
    if (password.length < 6) {
      throw new HttpException({ code: "WEAK_PASSWORD" }, 400);
    }

    const url = process.env.SUPABASE_URL;
    const sr = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !sr) throw new HttpException({ code: "SERVER_MISCONFIG" }, 500);

    let res: Response;
    try {
      res = await fetch(`${url}/auth/v1/admin/users`, {
        method: "POST",
        headers: { apikey: sr, Authorization: `Bearer ${sr}`, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, email_confirm: true }),
      });
    } catch {
      throw new HttpException({ code: "UPSTREAM_UNREACHABLE" }, 502);
    }

    if (res.ok) return { ok: true };

    const text = await res.text();
    if (res.status === 422 || /already|exists|registered|duplicate/i.test(text)) {
      throw new HttpException({ code: "EMAIL_TAKEN" }, 409);
    }
    throw new HttpException({ code: "REGISTER_FAILED" }, 400);
  }
}
