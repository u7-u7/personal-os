"use client";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MessageMarkdown({ content }: { content: string }) {
  return (
    <div className="message-markdown">
      <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
    </div>
  );
}
