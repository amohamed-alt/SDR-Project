export function localDateTimeToUtc(date: string, time: string, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute, 0);
  let timestamp = target;

  for (let pass = 0; pass < 2; pass += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(timestamp));
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((item) => item.type === type)?.value ?? 0);
    const represented = Date.UTC(
      part("year"),
      part("month") - 1,
      part("day"),
      part("hour"),
      part("minute"),
      part("second"),
    );
    timestamp += target - represented;
  }

  return new Date(timestamp).toISOString();
}

function localEnd(date: string, time: string, durationMinutes: number) {
  const timestamp = new Date(`${date}T${time}:00Z`).getTime() + durationMinutes * 60_000;
  const result = new Date(timestamp).toISOString();
  return { date: result.slice(0, 10), time: result.slice(11, 19) };
}

export function meetingInterval(
  date: string,
  time: string,
  durationMinutes: number,
  timeZone: string,
) {
  const end = localEnd(date, time, durationMinutes);
  return {
    startUtc: localDateTimeToUtc(date, time, timeZone),
    endUtc: localDateTimeToUtc(end.date, end.time.slice(0, 5), timeZone),
    startLocal: `${date}T${time}:00`,
    endLocal: `${end.date}T${end.time}`,
  };
}
