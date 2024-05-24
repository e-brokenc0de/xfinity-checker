export class ResetPasswordRequired extends Error {
  constructor(message: string) {
    super(message);

    this.name = "ResetPasswordRequired";
  }
}
