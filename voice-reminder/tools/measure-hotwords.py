"""Замер WER до и после hotwords на zipformer-ru.

Скрипт служебный: строит набор фраз с датами и временем, синтезирует их
русским голосом, распознаёт одной и той же моделью дважды — без hotwords и с
ними — и считает WER по словам. Результат идёт в комментарий к
VoskRecognitionPlugin.java и в ANDROID.md.

Запуск (python из рантайма DSH, в нём есть sherpa-onnx):
    python tools/measure-hotwords.py --out <папка для wav>
"""
import argparse
import asyncio
import io
import os
import re
import subprocess
import sys
import wave

MODEL = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "android", "app", "src", "main", "assets", "sherpa", "zipformer-ru",
)

# Фразы с датами и временем — именно те обороты, на которых модель ошибается
# чаще всего: «полчетвёртого», названия месяцев, «послезавтра».
CORPUS = [
    "напомни завтра в семь утра полить цветы",
    "напомни послезавтра в полчетвёртого позвонить маме",
    "напомни двадцать пятого декабря купить подарки",
    "напомни в час дня полить цветы",
    "напомни в час ночи выпить таблетку",
    "напомни тридцать первого декабря в двадцать три тридцать поздравить",
    "напомни первого сентября в восемь утра линейка",
    "напомни в половине одиннадцатого позвонить врачу",
    "напомни без четверти шесть забрать ребёнка",
    "напомни в четверть седьмого вечера зарядка",
    "напомни пятого ноября в десять утра сдать отчёт",
    "напомни в конце недели купить продукты",
    "напомни в эту пятницу позвонить маме",
    "напомни в следующий вторник встретить поезд",
    "напомни двадцать девятого февраля проверить дату",
    "напомни четырнадцатого февраля купить цветы",
    "напомни восьмого марта поздравить маму",
    "напомни в полдень поесть",
    "напомни в полночь встретить новый год",
    "напомни через два часа позвонить в банк",
    "напомни в девять ноль пять выйти из дома",
    "напомни двадцать второго июня в четыре утра выехать",
    "напомни в семь вечера забрать посылку",
    "напомни двадцатого октября в шесть вечера гости",
    "напомни в три часа дня совещание",
    "напомни одиннадцатого ноября продлить подписку",
    "напомни в восемь тридцать утра зарядка",
    "напомни третьего января вылет",
    "напомни в субботу в десять утра уборка",
    "напомни двадцать шестого ноября в девятнадцать тридцать кино",
]

VOICE = "ru-RU-SvetlanaNeural"


def synth(text, out_dir, index):
    """Синтезирует фразу и возвращает путь к wav 16 кГц моно."""
    import edge_tts

    mp3 = os.path.join(out_dir, f"phrase-{index:02d}.mp3")
    wav = os.path.join(out_dir, f"phrase-{index:02d}.wav")
    if not os.path.exists(mp3):
        asyncio.run(edge_tts.Communicate(text, VOICE).save(mp3))
    if not os.path.exists(wav):
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", mp3,
             "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav],
            check=True,
        )
    return wav


def read_wav(path):
    import numpy as np

    with wave.open(path) as w:
        assert w.getframerate() == 16000, w.getframerate()
        assert w.getnchannels() == 1
        raw = w.readframes(w.getnframes())
    return np.frombuffer(raw, dtype="<i2").astype("float32") / 32768.0


def add_noise(samples, snr_db):
    """Белый шум с заданным отношением сигнал/шум.

    Синтезированная речь — студийная запись: на ней модель ошибается редко, и
    разница «с hotwords / без» не видна. На телефоне запись идёт с
    расстояния и с фоном, поэтому для замера нужен шум: иначе вывод будет
    «всё и так работает» вместо ответа на вопрос, помогает ли список.
    """
    import numpy as np

    if snr_db is None:
        return samples
    power = float(np.mean(samples ** 2))
    if power <= 0:
        return samples
    noise = np.random.default_rng(42).normal(0, 1, len(samples)).astype("float32")
    noise_power = float(np.mean(noise ** 2))
    target = power / (10 ** (snr_db / 10.0))
    noise *= (target / noise_power) ** 0.5
    return (samples + noise).astype("float32")


def make_recognizer(hotwords_file="", score=1.5):
    import sherpa_onnx

    return sherpa_onnx.OfflineRecognizer.from_transducer(
        encoder=os.path.join(MODEL, "encoder.int8.onnx"),
        decoder=os.path.join(MODEL, "decoder.onnx"),
        joiner=os.path.join(MODEL, "joiner.int8.onnx"),
        tokens=os.path.join(MODEL, "tokens.txt"),
        num_threads=2,
        sample_rate=16000,
        feature_dim=80,
        decoding_method="modified_beam_search",
        max_active_paths=4,
        hotwords_file=hotwords_file,
        hotwords_score=score,
        modeling_unit="cjkchar",
        provider="cpu",
    )


def transcribe(rec, samples):
    s = rec.create_stream()
    s.accept_waveform(16000, samples)
    rec.decode_stream(s)
    return s.result.text


def words(text):
    text = text.lower().replace("ё", "е")
    return [w for w in re.split(r"[^а-яa-z0-9]+", text) if w]


def wer(ref, hyp):
    """Правка Левенштейна по словам: (расстояние, длина эталона)."""
    r, h = words(ref), words(hyp)
    prev = list(range(len(h) + 1))
    for i, rw in enumerate(r, 1):
        cur = [i]
        for j, hw in enumerate(h, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1,
                           prev[j - 1] + (rw != hw)))
        prev = cur
    return prev[-1], len(r)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(os.environ.get("TEMP", "."), "hotwords-wer"))
    ap.add_argument("--score", type=float, default=1.5)
    ap.add_argument("--hotwords", default="")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    hot = args.hotwords or os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "android", "app", "src", "main", "assets", "sherpa", "hotwords.txt",
    )

    print(f"модель: {MODEL}")
    print(f"hotwords: {hot} (score={args.score})")
    print()

    base = make_recognizer()
    with_hot = make_recognizer(hot, args.score)

    total_base = total_hot = total_len = 0
    worse = better = same = 0
    print(f"{'#':>3}  {'эталон':<52} {'без hotwords':<34} {'с hotwords'}")
    for i, text in enumerate(CORPUS):
        wav = synth(text, args.out, i)
        s = read_wav(wav)
        b = transcribe(base, s)
        h = transcribe(with_hot, s)
        db, n = wer(text, b)
        dh, _ = wer(text, h)
        total_base += db
        total_hot += dh
        total_len += n
        mark = "=" if db == dh else ("+" if dh < db else "-")
        if db == dh:
            same += 1
        elif dh < db:
            better += 1
        else:
            worse += 1
        print(f"{i:>3}  {text[:52]:<52} {b[:34]:<34} {h}  [{mark}]")

    print()
    print(f"WER без hotwords: {total_base / total_len:.3%} ({total_base}/{total_len})")
    print(f"WER с hotwords:   {total_hot / total_len:.3%} ({total_hot}/{total_len})")
    print(f"фраз стало лучше: {better}, хуже: {worse}, без изменений: {same}")


if __name__ == "__main__":
    sys.exit(main())
