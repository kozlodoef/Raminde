// components/Clock.jsx — крупные цифры текущего времени.
import React from "react";

export default function Clock({ value }) {
  const hm = value || "––:––";
  return (
    <div className="clock" aria-label={hm}>
      <span className="digit" key={"h" + hm.slice(0, 2)}>
        {hm.slice(0, 2)}
      </span>
      <span className="colon">:</span>
      <span className="digit" key={"m" + hm.slice(3)}>
        {hm.slice(3)}
      </span>
    </div>
  );
}
