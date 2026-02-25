"use client";
import { useState, useEffect } from "react";

interface AdPreviewProps {
  advertiserName?: string;
  headline?: string;
  bodyText?: string;
  imageUrl?: string;
  ctaText?: string;
  accentColor?: string;
  destinationUrl?: string;
  cardFormat?: "classic" | "banner" | "spotlight" | "portrait";
  campaignGoal?: "traffic" | "action" | "lead_gen";
  placement?: "feed" | "predict" | "both";
}

export function AdPreview({
  advertiserName = "Your Company",
  headline = "Your headline goes here",
  bodyText = "Your ad copy will appear here. Keep it concise and compelling.",
  imageUrl,
  ctaText = "Learn More",
  accentColor = "#10b981",
  destinationUrl: _destinationUrl,
  cardFormat = "classic",
  campaignGoal: _campaignGoal = "traffic",
  placement: _placement = "feed",
}: AdPreviewProps) {
  const [imgError, setImgError] = useState(false);
  useEffect(() => { setImgError(false); }, [imageUrl]);

  const safeAccentColor = /^#[0-9A-Fa-f]{6}$/.test(accentColor ?? "")
    ? accentColor!
    : "#10b981";
  const hasImage = !!imageUrl && !imgError;
  const badgeLabel = "SPONSORED";
  const gradientBg = `linear-gradient(135deg, #111827 0%, ${safeAccentColor}28 50%, #030712 100%)`;

  const phoneShell = "bg-gray-900 border border-gray-800 rounded-[1.5rem] overflow-hidden w-[300px] h-[520px] flex flex-col font-sans shrink-0 shadow-2xl relative";

  const chromebar = (
    <div className="bg-black/40 px-4 py-2 flex items-center border-b border-white/5 gap-1.5 shrink-0 z-10 backdrop-blur-md">
      <div className="w-2 h-2 rounded-full bg-red-500" />
      <div className="w-2 h-2 rounded-full bg-amber-500" />
      <div className="w-2 h-2 rounded-full bg-green-500" />
      <span className="text-gray-500 text-[10px] ml-auto font-mono tracking-widest font-semibold">
        CHAINSHORTS
      </span>
    </div>
  );

  const sponsoredBadge = (
    <div
      className="absolute top-3 left-3 text-black text-[9px] font-mono font-bold tracking-widest px-2 py-0.5 rounded shadow-sm z-10"
      style={{ backgroundColor: safeAccentColor }}
    >
      {badgeLabel}
    </div>
  );

  if (cardFormat === "classic") {
    return (
      <div className={phoneShell}>
        {chromebar}
        <div className="relative h-[180px] shrink-0 overflow-hidden">
          {hasImage ? (
            <img src={imageUrl} alt="Ad" onError={() => setImgError(true)} className="w-full h-full object-cover block" />
          ) : (
            <div className="w-full h-full" style={{ background: gradientBg }} />
          )}
          <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-gray-900 to-transparent" />
          {sponsoredBadge}
          <div className="absolute bottom-3 left-4 z-10">
            <div className="text-white text-xs font-mono font-bold tracking-wide drop-shadow-md">
              {advertiserName}
            </div>
          </div>
        </div>
        <div className="h-[3px] shrink-0" style={{ backgroundColor: safeAccentColor }} />
        <div className="p-4 flex-1 flex flex-col overflow-hidden bg-gray-900">
          <h3 className="text-white text-[1.05rem] font-bold mb-2.5 leading-snug line-clamp-3">
            {headline || "Your headline goes here"}
          </h3>
          <p className="text-gray-400 text-[0.82rem] leading-relaxed mb-auto flex-1 line-clamp-4">
            {bodyText || "Your ad copy will appear here. Keep it concise and compelling."}
          </p>
          <button
            className="mt-4 rounded-xl px-4 py-3 text-sm font-bold w-full font-mono tracking-wide text-black shrink-0 transition-opacity hover:opacity-90 active:scale-[0.98]"
            style={{ backgroundImage: `linear-gradient(135deg, ${safeAccentColor} 0%, ${safeAccentColor}CC 100%)` }}
          >
            {ctaText} →
          </button>
        </div>
      </div>
    );
  }

  if (cardFormat === "banner") {
    return (
      <div className={phoneShell}>
        {chromebar}
        <div className="px-4 py-2.5 flex items-center justify-between shrink-0 bg-gray-950" style={{ borderBottom: `2px solid ${safeAccentColor}` }}>
          <span className="text-white text-xs font-mono font-bold tracking-wider truncate mr-2">
            {advertiserName}
          </span>
          <span className="text-black text-[9px] font-mono font-bold tracking-widest px-1.5 py-0.5 rounded shrink-0" style={{ backgroundColor: safeAccentColor }}>
            {badgeLabel}
          </span>
        </div>
        <div className="relative h-[130px] shrink-0 overflow-hidden">
          {hasImage ? (
            <img src={imageUrl} alt="Ad" onError={() => setImgError(true)} className="w-full h-full object-cover block" />
          ) : (
            <div className="w-full h-full" style={{ background: `linear-gradient(90deg, #030712 0%, ${safeAccentColor}40 50%, #030712 100%)` }} />
          )}
        </div>
        <div className="h-1 shrink-0" style={{ background: `linear-gradient(90deg, ${safeAccentColor}, ${safeAccentColor}66)` }} />
        <div className="p-4 flex-1 flex flex-col overflow-hidden bg-gray-900">
          <h3 className="text-white text-lg font-extrabold mb-2 leading-tight line-clamp-2">
            {headline || "Your headline goes here"}
          </h3>
          <p className="text-gray-400 text-xs leading-relaxed flex-1 line-clamp-3">
            {bodyText || "Your ad copy will appear here. Keep it concise and compelling."}
          </p>
          <button
            className="mt-4 rounded-xl px-4 py-3 text-[15px] font-extrabold w-full font-mono tracking-wide text-black shrink-0 transition-opacity hover:opacity-90 active:scale-[0.98]"
            style={{ backgroundColor: safeAccentColor }}
          >
            {ctaText} →
          </button>
        </div>
      </div>
    );
  }

  if (cardFormat === "portrait") {
    return (
      <div className={phoneShell}>
        {chromebar}
        <div className="relative flex-1 overflow-hidden min-h-0">
          {hasImage ? (
            <img src={imageUrl} alt="Ad" onError={() => setImgError(true)}
                 className="absolute inset-0 w-full h-full object-cover" />
          ) : (
            <div className="absolute inset-0" style={{ background: gradientBg }} />
          )}
          {/* Dark gradient bottom overlay */}
          <div className="absolute inset-x-0 bottom-0 h-3/5 pointer-events-none"
               style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.6) 50%, transparent 100%)' }} />
          {/* SPONSORED badge top-left */}
          {sponsoredBadge}
          {/* Advertiser name top-right */}
          <div className="absolute top-3 right-3 text-[10px] font-mono font-bold tracking-widest drop-shadow-md"
               style={{ color: safeAccentColor }}>
            {advertiserName.toUpperCase()}
          </div>
          {/* Bottom overlay: headline + CTA */}
          <div className="absolute bottom-5 inset-x-4 flex flex-col gap-3">
            <h3 className="text-white text-[1.1rem] font-extrabold leading-snug line-clamp-3 m-0 drop-shadow-lg">
              {headline || "Your headline goes here"}
            </h3>
            <button
              className="w-full rounded-xl py-3.5 text-sm font-extrabold font-mono tracking-wide text-black transition-opacity hover:opacity-90"
              style={{ backgroundImage: `linear-gradient(135deg, ${safeAccentColor} 0%, ${safeAccentColor}CC 100%)` }}
            >
              {ctaText} →
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Spotlight
  return (
    <div className={phoneShell}>
      {chromebar}
      <div className="relative shrink-0 overflow-hidden h-[270px]">
        {hasImage ? (
          <img src={imageUrl} alt="Ad" onError={() => setImgError(true)} className="w-full h-full object-cover block" />
        ) : (
          <div className="w-full h-full" style={{ background: `radial-gradient(circle at 40% 40%, ${safeAccentColor}55 0%, #030712 70%)` }} />
        )}
        <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-gray-900 via-gray-900/60 to-transparent z-0" />
        {sponsoredBadge}
        <div className="absolute bottom-3 inset-x-4 z-10">
          <div className="text-gray-300 text-[10px] font-mono font-bold tracking-widest mb-1.5 drop-shadow-md">
            {advertiserName}
          </div>
          <h3 className="text-white text-lg font-extrabold m-0 leading-tight line-clamp-2 drop-shadow-lg">
            {headline || "Your headline goes here"}
          </h3>
        </div>
      </div>
      <div className="h-[3px] shrink-0" style={{ backgroundColor: safeAccentColor }} />
      <div className="p-4 flex-1 flex flex-col justify-center overflow-hidden bg-gray-900">
        <p className="text-gray-400 text-xs leading-relaxed mb-4 line-clamp-2">
          {bodyText || "Your ad copy will appear here. Keep it concise and compelling."}
        </p>
        <button
          className="rounded-xl px-4 py-2.5 text-sm font-bold w-full font-mono tracking-wide bg-transparent transition-all hover:bg-white/5 active:scale-[0.98]"
          style={{ color: safeAccentColor, border: `2px solid ${safeAccentColor}` }}
        >
          {ctaText} →
        </button>
      </div>
    </div>
  );
}
