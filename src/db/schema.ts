import { Table } from '@andrewitsover/midnight';

class Trees extends Table {
    name = this.Text;
    planted = this.DateTime();
    alive = this.Bool;
}

export const schema = {
    Trees,
};
