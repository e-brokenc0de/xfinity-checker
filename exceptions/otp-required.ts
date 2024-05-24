export class OtpRequired extends Error {
  constructor(message: string) {
    super(message);

    this.name = "OtpRequired";
  }
}
