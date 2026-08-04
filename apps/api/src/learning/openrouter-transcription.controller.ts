import {
  Body, Controller, Param, Post, UploadedFile, UseGuards, UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { AuthUser } from "../auth/supabase.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { SupabaseAuthGuard } from "../auth/supabase.guard";
import { OpenRouterTranscriptionService } from "./openrouter-transcription.service";

@Controller()
@UseGuards(SupabaseAuthGuard)
export class OpenRouterTranscriptionController {
  constructor(private readonly transcription: OpenRouterTranscriptionService) {}

  @Post("learning-sessions/:id/spelling-translation-transcriptions")
  @UseInterceptors(FileInterceptor("audio", {
    limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  }))
  transcribe(
    @CurrentUser() user: AuthUser,
    @Param("id") sessionId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body("wordId") wordId: string,
    @Body("expectedRevision") expectedRevision: string,
  ) {
    return this.transcription.transcribe(
      user.id,
      sessionId,
      wordId,
      expectedRevision,
      file,
    );
  }
}
