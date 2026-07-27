import {
  Body, Controller, Get, Param, Post, Res, StreamableFile, UploadedFile, UseGuards, UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import type { AuthUser } from "../auth/supabase.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { SupabaseAuthGuard } from "../auth/supabase.guard";
import { PronunciationService } from "./pronunciation.service";

@Controller("pronunciation")
@UseGuards(SupabaseAuthGuard)
export class PronunciationController {
  constructor(private readonly pronunciation: PronunciationService) {}

  @Get("audio/:wordId")
  async audio(@CurrentUser() user: AuthUser, @Param("wordId") wordId: string, @Res({ passthrough: true }) response: Response) {
    const asset = await this.pronunciation.audio(user.id, wordId);
    response.setHeader("ETag", `"${asset.cacheKey}"`);
    if (!asset.bytes) {
      response.status(202);
      response.setHeader("Retry-After", "3");
      response.setHeader("Cache-Control", "no-store");
      return {
        code: "AUDIO_PENDING",
        message: "Audio is being prepared",
        cacheKey: asset.cacheKey,
        status: asset.status,
      };
    }
    response.setHeader("Content-Type", Buffer.from(asset.bytes).subarray(0, 4).toString("ascii") === "RIFF" ? "audio/wav" : "audio/mpeg");
    response.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    return new StreamableFile(Buffer.from(asset.bytes));
  }

  @Post("assess")
  @UseInterceptors(FileInterceptor("audio", { limits: { fileSize: 2 * 1024 * 1024, files: 1 } }))
  assess(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body("sessionId") sessionId: string,
    @Body("wordId") wordId: string,
  ) {
    return this.pronunciation.assess(user.id, sessionId, wordId, file);
  }
}
