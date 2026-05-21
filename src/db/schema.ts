import { Table } from '@andrewitsover/midnight';

class Prompt extends Table {
  name = this.Text;
  planted = this.DateTime();
  alive = this.Bool;
}

export const schema = {
  Prompt
};
